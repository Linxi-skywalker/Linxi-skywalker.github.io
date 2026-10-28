/** Small math-only parser + forward automatic differentiation; never executes source code. */
const functions={
  sin:[Math.sin,Math.cos],cos:[Math.cos,x=>-Math.sin(x)],tan:[Math.tan,x=>1/Math.cos(x)**2],
  exp:[Math.exp,Math.exp],log:[Math.log,x=>1/x],ln:[Math.log,x=>1/x],
  sqrt:[Math.sqrt,x=>0.5/Math.sqrt(x)],tanh:[Math.tanh,x=>1-Math.tanh(x)**2]
};
const constant=value=>({op:'number',value});
function compute(n,x,y,dual=false){
  if(n.op==='number')return dual?[n.value,0,0]:n.value;
  if(n.op==='x')return dual?[x,1,0]:x;
  if(n.op==='y')return dual?[y,0,1]:y;
  const a=compute(n.a,x,y,dual),b=n.b?compute(n.b,x,y,dual):null;
  if(!dual){
    if(n.op==='+')return a+b;if(n.op==='-')return a-b;
    if(n.op==='*')return a*b;if(n.op==='/')return a/b;if(n.op==='^')return a**b;
    return functions[n.op][0](a);
  }
  const [av,ax,ay]=a,[bv,bx,by]=b??[];
  if(n.op==='+')return [av+bv,ax+bx,ay+by];
  if(n.op==='-')return [av-bv,ax-bx,ay-by];
  if(n.op==='*')return [av*bv,ax*bv+av*bx,ay*bv+av*by];
  if(n.op==='/')return [av/bv,(ax*bv-av*bx)/bv**2,(ay*bv-av*by)/bv**2];
  if(n.op==='^'){
    const value=av**bv;
    if(n.b.op==='number'){
      const scale=bv===0?0:bv*av**(bv-1);
      return [value,scale*ax,scale*ay];
    }
    return [value,value*(bx*Math.log(av)+bv*ax/av),value*(by*Math.log(av)+bv*ay/av)];
  }
  const [fn,derivative]=functions[n.op],scale=derivative(av);
  return [fn(av),scale*ax,scale*ay];
}
export function compileExpression(input){
  const source=String(input).trim();
  if(!source)throw new RangeError('请先输入函数，例如 x^2 + y^2。');
  if(source.length>320)throw new RangeError('函数请控制在 320 个字符内。');
  const text=source.replaceAll('₁','1').replaceAll('₂','2').replaceAll('²','^2').replaceAll('³','^3').replaceAll('−','-').replaceAll('×','*').replaceAll('÷','/').replaceAll('π','pi').replaceAll('**','^');
  const tokens=[];let pos=0;
  while(pos<text.length){
    if(/\s/.test(text[pos])){pos++;continue;}
    const m=/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[a-zA-Z][a-zA-Z0-9_]*|^[+\-*/^()]/.exec(text.slice(pos));
    if(!m)throw new RangeError(`第 ${pos+1} 位“${text[pos]}”无法识别，只能输入数学表达式。`);
    tokens.push(m[0].toLowerCase());pos+=m[0].length;
  }
  let index=0,nodes=0;
  const peek=()=>tokens[index];
  const node=(op,a,b)=>{
    if(++nodes>160)throw new RangeError('函数过于复杂，请缩短表达式。');
    const n={op,a,b};
    return a.op==='number'&&(!b||b.op==='number')?constant(compute(n,0,0)):n;
  };
  function primary(){
    const t=tokens[index++];
    if(t==='('){const n=sum();if(tokens[index++]!==')')throw new RangeError('括号没有配对。');return n;}
    if(t==='x'||t==='w1')return {op:'x'};
    if(t==='y'||t==='w2')return {op:'y'};
    if(t==='pi'||t==='e')return constant(t==='pi'?Math.PI:Math.E);
    if(t&&/^(\d|\.)/.test(t))return constant(Number(t));
    if(Object.hasOwn(functions,t)){
      if(tokens[index++]!=='(')throw new RangeError(`${t} 后需要括号，例如 ${t}(x)。`);
      const a=sum();if(tokens[index++]!==')')throw new RangeError(`${t} 的括号没有配对。`);
      return node(t,a);
    }
    throw new RangeError(t?`无法识别“${t}”，变量请用 x、y 或 w1、w2。`:'表达式未写完整。');
  }
  function power(){const a=primary();return peek()==='^'?(index++,node('^',a,unary())):a;}
  function unary(){if(peek()==='+'){index++;return unary();}if(peek()==='-'){index++;return node('-',constant(0),unary());}return power();}
  function product(){
    let a=unary();
    while(peek()==='*'||peek()==='/'||(peek()&&/^(?:[a-z\d.]|\()/.test(peek()))){
      const op=peek()==='*'||peek()==='/'?tokens[index++]:'*';a=node(op,a,unary());
    }
    return a;
  }
  function sum(){let a=product();while(peek()==='+'||peek()==='-'){const op=tokens[index++];a=node(op,a,product());}return a;}
  const ast=sum();if(index!==tokens.length)throw new RangeError(`请检查“${peek()}”附近的括号或运算符。`);
  return {expression:source,value:(x,y)=>compute(ast,x,y),gradient:(x,y)=>compute(ast,x,y,true).slice(1)};
}

export function validateExpression(fn,start={x:-4,y:4}){
  const check=(x,y,derivative)=>{
    const value=fn.value(x,y),g=derivative?fn.gradient(x,y):[];
    if(![value,...g].every(Number.isFinite)||Math.abs(value)>1e12)throw new RangeError(`在 (w₁=${x.toFixed(3)}, w₂=${y.toFixed(3)}) 函数或梯度无效，或 |L| 超过 10¹²。请使用在 [-5,5]² 内有定义的光滑函数。`);
  };
  for(let j=0;j<=120;j++)for(let i=0;i<=120;i++)check(-5+i/12,-5+j/12,i%5===0&&j%5===0);
  check(start.x,start.y,true);
  return fn;
}
