---
title: xjtu-ics-linkerlab
date: "2026-06-06"
category: lucid
tags: [xjtu-ics, 代码]
description: 生命中出现的人和事，都会汇聚到这条河流，跟你一起周而复始。
pinned: false
---

# XJTU-ICS Lab6: Linker Lab

> 💡 **写在前面（一点碎碎念）：**
> 本文记录的解法，**绝非唯一答案，更不代表最优解**（~~另外文章当中还可能存在未被发现的bug🪲~~）。
> Lab 的灵魂就在于死磕的过程，**强烈建议你在看本文前先独立思考、自己多碰几次壁**。代码仅供卡壳时对齐思路，**请勿直接抄袭**——相信我，独立通关的成就感，远比直接抄个 100 分要爽得多😉

# LinkerLab

## What should we do? 

由于link的过程比较复杂，课程组为了简化lab以及让大家能够理解实验过程手册写的比较详细


实际上我需要做的事情就是用C++实现一个简化版静态链接器（模拟link的过程），完成两件工作：

1. **符号解析**（`resolve.cc`）：找到每一个引用对应的定义，绑定 `RelocEntry.sym`。
2. **重定位**（`relocation.cc`）：在合并后的目标文件中，把代码里留空的地址填入正确的值。



## Part 1：重定位（test0 / test1）

### 这部分在做什么

目标文件里的代码在编译时不知道最终的内存布局，凡是访问某个变量或函数地址的地方，编译器都留了空（填 0）。链接完成、地址确定之后，需要把正确的地址填进去，这个过程就是重定位。

`handleRela` 函数需要遍历所有目标文件的重定位表（`relocTable`），对每一条 `RelocEntry`，找到需要填入的位置，算出填入的值，然后写进去。

### 向哪里写

`RelocEntry` 的 `offset` 字段表示"需要填入的那几个字节距离 `.text` 节起始位置的偏移"。

需要填入的位置在文件中的地址是：

```
写入位置（内存地址）= baseAddr + textOff + re.offset
```

- `baseAddr`：`mmap` 把文件映射到内存后的基地址，从 `mergedObject.baseAddr` 转换得到


获取 `baseAddr`，需要把指针转换为整数才能做整数加法：

```cpp
uint64_t baseAddr = reinterpret_cast<uint64_t>(mergedObject.baseAddr);
```

- `textOff`：`.text` 节在文件中的偏移（不是运行时地址）
- `re.offset`：重定位条目在 `.text` 节内的偏移

注意这里用的是 `textOff` 而不是 `textAddr`——`mmap` 操作的是文件，所以要用文件偏移。

### 写入什么

目标文件里的代码在编译时不知道最终的内存布局，凡是访问某个变量或函数地址的地方，编译器都留了空（填 0）。链接完成、地址确定之后，需要把**正确的地址**填进去，也就是我们需要写入某个变量或函数在内存中的地址（准确地说是某个偏移最终得到地址，这个偏移量在编译时编译器无法确定）

**理解 PC 相对寻址（`R_X86_64_PC32`）**

CPU 执行指令时，`$rip` 指向的是**下一条指令**的地址，不是当前指令。

用 test0 的 objdump 验证：

```
1131: c7 05 d5 2e 00 00 02    movl $0x2, 0x2ed5(%rip)   # 4010 <a>
1138: 00 00 00
```

- 指令从 `0x1131` 开始，占 9 字节，下一条指令在 `0x113b`也就是`$rip`
- 填入的偏移是 `0x2ed5`(注意这个偏移是小端方式，占4字节：d5 2e 00 00)
- `0x113b + 0x2ed5 = 0x4010` ✓，正好是 `a` 的地址

链接器要往指令里填一个偏移值，让 CPU 运行时能正确找到符号a

所以：**填入值 = 符号地址 - `$rip`**

假设指令在内存里长这样
```
地址：
0x1000  操作码    ← 指令开始
0x1001  操作码
0x1002  偏移第1字节
0x1003  偏移第2字节
0x1004  偏移第3字节
0x1005  偏移第4字节  ← 4 字节偏移结束
0x1006  下一条指令  ← RIP 最终指向这里！
```
重定位要修改的位置（偏移字段）从 0x1002 开始,这个偏移字段占 4 字节,CPU 读完这 4 字节，RIP 就走到了 0x1002 + 4 = 0x1006

也就是说`$rip` = 需要填入的位置的地址 + 4（因为偏移量字段本身占 4 字节，读完后 `$rip` 前进了 4 字节）：

```
$rip = textAddr + re.offset + 4
```
这里我们需要使用textAddr ：指 .text 节被运行时加载后在内存中所处的位置，再加上`re.offset`：重定位条目在 `.text` 节内的偏移，即可找到需要填入的正确地址值
```
重定位偏移字段的起始地址= `textAddr = .text 段加载基地址` + `re.offset = 重定位条目在 .text 里的偏移`
```

因此最终填入值（忽略 addend）= `re.sym->value - $rip` = `re.sym->value - textAddr - re.offset - 4`

**addend 的意义**

手册公式是：

```
填入值 = re.sym->value - (re.offset + textAddr) + re.addend
```

对比自己的推导，`re.addend = -4`，这个 `-4` 是编译器预先算好放进去的，用来补偿 `$rip` 自动前进 4 字节。

`R_X86_64_32`（绝对地址）不依赖 `$rip`，直接填符号地址，这时：
```
填入值 = re.sym->value + re.addend
```
实际上，由于此时是绝对地址不再需要rip相对寻址，addend 为 0。（addend 里的 -4 本质上是对 $rip 自动前进4字节的补偿，绝对寻址不依赖 $rip，所以不需要这个补偿）

**`R_X86_64_PLT32`** 也是 PC 相对寻址，处理方式与 `R_X86_64_PC32` 完全一致。


### 实现重定位
这一过程其实就是向我们算出的“写到那里”的地址写入“写入什么"的值

向特定地址写入 4 字节整数：

```cpp
*reinterpret_cast<int *>(addr) = valueToFill;
```

## 多文件重定位偏移调整（test4 / test5）

### 这部分在做什么

多个 `.o` 文件合并成一个时，各文件的 `.text` 节被顺序拼接：

```
[文件1的.text][文件2的.text][文件3的.text]...
```

每个文件里的 `re.offset` 是相对于**自己文件** `.text` 节起始位置的偏移。合并后这个偏移需要加上前面所有文件的 `.text` 大小，才是相对于合并后 `.text` 起始位置的正确偏移。

举例：
- 文件1 的 `.text` 大小为 `0x28`，有一条 `re.offset = 0x4`
- 文件2 的 `.text` 大小为 `0x30`，有一条 `re.offset = 0x8`

调整后：
- 文件1 的 `re.offset` 不变，仍为 `0x4`（前面没有文件）
- 文件2 的 `re.offset` 变为 `0x8 + 0x28 = 0x30`

代码实现：

```cpp
if (allObject.size() > 1) {
    uint64_t offset = 0;
    for (auto &obj : allObject) {
        for (auto &re : obj.relocTable) {
            re.offset += offset;
        }
        offset += obj.sections[".text"].size;
    }
}
```


### 完整代码

```cpp
#include "relocation.h"
#include <sys/mman.h>

void handleRela(std::vector<ObjectFile> &allObject, ObjectFile &mergedObject, bool isPIE)
{
    // 多文件时调整 offset
    if (allObject.size() > 1) {
        uint64_t offset = 0;
        for (auto &obj : allObject) {
            for (auto &re : obj.relocTable) {
                re.offset += offset;
            }
            offset += obj.sections[".text"].size;
        }
    }

    uint64_t userCodeStart = isPIE ? 0xe9 : 0xe6;
    uint64_t textOff  = mergedObject.sections[".text"].off  + userCodeStart;
    uint64_t textAddr = mergedObject.sections[".text"].addr + userCodeStart;

    for (auto &obj : allObject) {
        for (auto &re : obj.relocTable) {
            uint64_t baseAddr = reinterpret_cast<uint64_t>(mergedObject.baseAddr);
            uint64_t ToAddr = baseAddr + re.offset + textOff;

            if (re.type == R_X86_64_PC32 || re.type == R_X86_64_PLT32) {
                // PC 相对寻址：填入值 = 符号地址 - $rip + addend
                // $rip = textAddr + re.offset + 4，addend 已包含 -4
                int valueToFill = re.sym->value - re.offset - textAddr + re.addend;
                *reinterpret_cast<int *>(ToAddr) = valueToFill;
            } else if (re.type == R_X86_64_32) {
                // 绝对地址：直接填符号地址
                int valueToFill = re.sym->value + re.addend;
                *reinterpret_cast<int *>(ToAddr) = valueToFill;
            }
        }
    }
}
```

---

## Part 2：符号解析（test2 / test3）

### 这部分在做什么

多个目标文件之间可能互相引用对方定义的符号。符号解析的目的是为每一条 `RelocEntry` 找到它对应的符号定义，并把 `re.sym` 指针指向那个定义（称为"绑定"）。

如果找不到定义，报 `NO_DEF`；如果同一个符号被定义了多次，报 `MULTI_DEF`。

实际上一开始我也是按照测试点的思路从test2的未定义->test3的多个强定义->test4的一强一弱
但做的过程中经常是这里对了那里又错了，建议理解完整个link的过程后自顶向下完成整个逻辑而不是缝缝补补，书写体验及其不佳


### 强符号的判断条件

1. `sym.name == re.name`
2. `sym.bind == STB_GLOBAL`
3. `sym.index != SHN_UNDEF && sym.index != SHN_COMMON`

### 弱符号的判断条件

1. `sym.name == re.name`
2. `sym.bind == STB_GLOBAL`
3. `sym.index == SHN_COMMON`  ~~手册：`index == SHN_UNDEF || index == SHN_COMMON`~~

### 关于手册的一处错误

手册说弱符号条件之一是 `index == SHN_UNDEF || index == SHN_COMMON`，但这是不准确的。

用 `readelf -s` 验证：

```
# extcall.o 中的未定义引用 foo（应报 NO_DEF）
4: 0000000000000000  0 NOTYPE  GLOBAL DEFAULT  UND foo

# weakdef.o 中的真正弱符号 a
3: 0000000000000004  4 OBJECT  GLOBAL DEFAULT  COM a
```

`foo` 同时满足手册描述的弱符号三个条件（名字匹配、`STB_GLOBAL`、`SHN_UNDEF`），但它是未定义引用，不是弱符号。如果按手册实现，test2 会无法正确报错。

真正的弱符号 `index = SHN_COMMON`，未定义引用 `index = SHN_UNDEF`，两者可以区分。正确条件只用 `index == SHN_COMMON`。


**最终思路**：对每一条 `re`，初始化 `re.sym = nullptr` 和 `isStrong = false`（用于判断是否为强定义），然后遍历所有符号：
- 找到强定义：`isStrong` 已为 `true` 则报 `MULTI_DEF`，否则绑定并设 `isStrong = true`
- 找到弱定义：只有 `re.sym == nullptr` 时才绑定（不覆盖强定义）
- 遍历完后 `re.sym == nullptr` 则报 `NO_DEF`



### 完整代码

```cpp
#include "resolve.h"
#include <iostream>

#define FOUND_ALL_DEF 0
#define MULTI_DEF 1
#define NO_DEF 2

std::string errSymName;

int callResolveSymbols(std::vector<ObjectFile> &allObjects);

void resolveSymbols(std::vector<ObjectFile> &allObjects) {
    int ret = callResolveSymbols(allObjects);
    if (ret == MULTI_DEF) {
        std::cerr << "multiple definition for symbol " << errSymName << std::endl;
        abort();
    } else if (ret == NO_DEF) {
        std::cerr << "undefined reference for symbol " << errSymName << std::endl;
        abort();
    }
}

int callResolveSymbols(std::vector<ObjectFile> &allObjects)
{
    for (auto &obj : allObjects) {
        for (auto &re : obj.relocTable) {
            bool isStrong = false;
            re.sym = nullptr;

            for (auto &obj2 : allObjects) {
                for (auto &sym : obj2.symbolTable) {
                    // 强符号：GLOBAL 且有定义
                    if (sym.name == re.name &&
                        sym.bind == STB_GLOBAL &&
                        sym.index != SHN_UNDEF &&
                        sym.index != SHN_COMMON) {
                        if (isStrong) {
                            errSymName = re.name;
                            return MULTI_DEF;
                        }
                        re.sym = &sym;
                        isStrong = true;
                    }
                    // 弱符号：GLOBAL 且 index == SHN_COMMON
                    // 注意：手册说弱符号包含 SHN_UNDEF，但实测不正确
                    // 真正的弱符号 index 为 SHN_COMMON，SHN_UNDEF 是未定义引用
                    else if (sym.name == re.name &&
                             sym.bind == STB_GLOBAL &&
                             sym.index == SHN_COMMON) {
                        if (re.sym == nullptr) {
                            re.sym = &sym;
                        }
                    }
                }
            }

            if (re.sym == nullptr) {
                errSymName = re.name;
                return NO_DEF;
            }
        }
    }
    return FOUND_ALL_DEF;
}
```

---

**这时已经得到了100分，但真的做完了么？**

---

## 关于 test4 / test5 的说明

实际上后续发现我的代码并没有完成后两个测试点就拿到了分数，这在手册中也提到了

**为什么 test2/3 能发现错误，test4/5 不能**

test2/3 需要你的代码**主动 abort**，如果你没有在正确时机 abort，程序会继续走到 `mergeObjects`，系统 `ld` 处理后正常退出，autograder 看到程序正常退出就判定你没有正确报错，测试失败。所以错误会被暴露。

test4/5 不需要报错，只需要最终可执行文件运行结果正确。符号解析代码跑完之后，系统 `ld` 在 `mergeObjects` 里重新做了一遍完整的符号解析和合并，生成的文件地址已经是对的。我们的重定位公式是动态计算的，拿到正确地址就填入正确值，autograder 看到可执行文件运行结果正确就通过。符号解析逻辑对不对，完全没有被检验到。

---

**我的代码实际上怎么处理一强一弱和多弱**

**一强一弱**：

遍历符号时，如果先遇到弱符号，`re.sym` 先绑定到弱符号；后来遇到强符号，因为 `isStrong == false`，用强符号覆盖绑定，`isStrong = true`。最终 `re.sym` 指向强符号，这条 `re` 的绑定是对的。但弱符号那个 `Symbol` 对象的 `value` 没有被改成和强符号一样，它仍然保留自己的地址。由于系统 `ld` 已经处理好了合并，实际上不影响结果。

**多弱**：

遍历时第一个遇到的弱符号被绑定到 `re.sym`，后续同名弱符号因为 `re.sym != nullptr` 被跳过。每条 `re` 都绑定到"第一个被遍历到的弱符号"，但不同的 `re` 遍历顺序相同，所以实际上都绑定到了同一个弱符号对象。其他弱符号对象的 `value` 没有被统一。同样由于系统 `ld` 处理好了合并，不影响结果。

---

## 解决这一问题：
实际上，解决的思路也比较简单：遍历所有 obj 的所有 sym，如果这个 sym 是弱符号`（bind == STB_GLOBAL && index == SHN_COMMON）`，再去所有 re 里找有没有同名的 re 已经绑定到了强符号或者另一个弱符号上，如果找到了就把这个 `sym` 的 `value` 和 `index` 改成 `re.sym `的。

也就是在程序返回之前加入：
```cpp
for (auto &obj : allObjects) {
    for (auto &sym : obj.symbolTable) {
        if (sym.bind == STB_GLOBAL && sym.index == SHN_COMMON) {
            for (auto &obj2 : allObjects) {
                for (auto &re : obj2.relocTable) {
                    if (re.name == sym.name && re.sym != nullptr) {
                        sym.value = re.sym->value;
                        sym.index = re.sym->index;
                        break;
                    }
                }
            }
        }
    }
}
```

最终代码：
```cpp
int callResolveSymbols(std::vector<ObjectFile> &allObjects)
{
    /* Your code here */
    // if found multiple definition, set the errSymName to problematic symbol name and return MULTIDEF;
    // if no definition is found, set the errSymName to problematic symbol name and return NODEF;


    for(auto &obj : allObjects){
        for(auto &re :obj.relocTable){
            bool isStrong = false;
            re.sym = nullptr;
            for(auto &obj2 : allObjects){
                for(auto &sym : obj2.symbolTable){
                    if(sym.name == re.name && sym.bind == STB_GLOBAL && sym.index != SHN_UNDEF && sym.index != SHN_COMMON){
                       
                         if(isStrong){
                            errSymName = re.name;
                            return MULTI_DEF;
                       }
                         if(!isStrong){
                            re.sym = &sym;
                        }
                         isStrong = true;
                    }
                    else if(sym.name == re.name && sym.bind == STB_GLOBAL && ( sym.index == SHN_COMMON)){
                        
                        if(re.sym == nullptr){
                            re.sym = &sym;
                        }

                    }                    
        }
    }
        
                   if(re.sym == nullptr){
                        errSymName = re.name;
                        return NO_DEF;
                    }

    }


}
    for (auto &obj : allObjects) {
    for (auto &sym : obj.symbolTable) {
        if (sym.bind == STB_GLOBAL && sym.index == SHN_COMMON) {
            for (auto &obj2 : allObjects) {
                for (auto &re : obj2.relocTable) {
                    if (re.name == sym.name && re.sym != nullptr) {
                        sym.value = re.sym->value;
                        sym.index = re.sym->index;
                        break;
                    }
                }
            }
        }
    }
}

    return FOUND_ALL_DEF;

}
```