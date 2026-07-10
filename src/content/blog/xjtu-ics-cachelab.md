---
title: xjtu-ics-cachelab
date: "2026-04-29"
category: lucid
tags: [xjtu-ics, 代码]
description: Don't repeat yourself
pinned: false
---

# XJTU-ICS Lab4：Cache Lab

> 💡 **写在前面（一点碎碎念）：**
> 本文记录的解法，**绝非唯一答案，更不代表最优解**（~~另外文章当中还可能存在未被发现的bug🪲~~）。
> Lab 的灵魂就在于死磕的过程，**强烈建议你在看本文前先独立思考、自己多碰几次壁**。代码仅供卡壳时对齐思路，**请勿直接抄袭**——相信我，独立通关的成就感，远比直接抄个 100 分要爽得多😉

# Cache Lab Part A 



##  第一步：地址解析

首先我们需要根据各级cache的配置提取出有效信息（tag、setindex...）

三级 cache 的配置：

| 级别 | sets | ways | line size |
|------|------|------|-----------|
| L1D/I | 4 | 2 | 8B |
| L2 | 8 | 4 | 8B |
| L3 | 16 | 8 | 16B |

对于一个 64 位地址，每一级 cache 的分解方式不同：

**L1**（line=8B, sets=4）：
- offset = 3 bits（log2(8)）
- set index = 2 bits（log2(4)）
- tag = 剩余高位(59bits)

```c
uint64_t l1_seti = (addr >> 3) & 0x3;
uint64_t l1_tag  = addr >> 5;
```

**L2**（line=8B, sets=8）：
- offset = 3 bits
- set index = 3 bits（log2(8)）
- tag = 剩余高位(58bits)

```c
uint64_t l2_seti = (addr >> 3) & 0x7;
uint64_t l2_tag  = addr >> 6;
```

**L3**（line=16B, sets=16）：
- offset = 4 bits（log2(16)）
- set index = 4 bits（log2(16)）
- tag = 剩余高位(56bits)

```c
uint64_t l3_seti = (addr >> 4) & 0xf;
uint64_t l3_tag  = addr >> 8;
```


---

##  初始化

`cacheInit` 比较简单，把所有 cache line 的字段清零就行。

```c
void cacheInit(int levels) {
    cache_levels = levels;  
    for (int i = 0; i < L1_SET_NUM; i++) {
        for (int j = 0; j < L1_LINE_NUM; j++) {
            l1dcache[i][j].valid = false;
            l1dcache[i][j].dirty = false;
            l1dcache[i][j].tag   = 0;
            l1dcache[i][j].latest_used = 0;
            // L1I 同理
        }
    }
    if (cache_levels == 1) return;
    // L2、L3 同理
}
```

---

##  最初的想法

我最开始的想法是在 `cacheAccess` 里直接处理所有情况，大概长这样：

```c
// 错误示范
if (op == 'I') {
    // 在 L1I 里查找
    for (int i = 0; i < L1_LINE_NUM; i++) {
        if (l1icache[l1_seti][i].valid && l1icache[l1_seti][i].tag == l1_tag) {
            l1i_hits++;
            return;
        }
    }
    l1i_misses++;
    // 去 L2 查找
    for (int i = 0; i < L2_LINE_NUM; i++) {
        if (l2ucache[l2_seti][i].valid && l2ucache[l2_seti][i].tag == l2_tag) {
            l2_hits++;
            return;  // 直接 return 了！
        }
    }
    // ...
}
```

这个写法有个根本性的问题：**L2 hit 之后直接 return 了，数据没有装回 L1**。

inclusive policy 要求 L1 miss 去 L2 找到数据后，必须把数据装入 L1。直接 return 跳过了这个步骤。

另外还有一个更严重的问题：这种写法，L2 和 L3 的查找都在用 L1 的 seti 和 tag，完全算错了。

---

##  递归

事实上上面这种方法不可行是因为L1,L2,L3存在很强的相关性，通常需要逐层访问而且各层的操作几乎是一样的，于是自然想到了递归。

每一层 cache 的操作逻辑其实是完全一样的：
1. 查找当前层有没有这个地址
2. 有就 hit，更新 LRU，返回
3. 没有就 miss，去下一层找，找回来后装入当前层

从这个"去下一层找，找回来后装入当前层"逻辑就可以确定递归结构。

于是我们可以定义一个用于递归的函数：


```c
void recursivecache(int level, bool isInstruction, bool isWrite, uint64_t addr);
```
我们需要思考我们希望传入函数的参数，自然的必须需要的参数有：

- `level`：当前在哪一级（1/2/3）
- `isInstruction`：区分 L1I 和 L1D（L2/L3 是 unified，这个参数对它们无效）
- `isWrite`：是读还是写（影响 dirty 位）（事实上，一开始还没有考虑到dirty时并没有设计这个参数，但后来发现这个参数也是必须的）
- `addr`：访问的内存地址

**终止条件**：`level > cache_levels`，说明到内存了，直接 return（内存里一定有数据，不需要任何操作，这里我们是在模拟cache的一些操作，因此怎么从内存取数据我们并不关心，只需要设计出这个逻辑即可）。

递归的核心逻辑：

```
recursivecache(level, isInstruction, isWrite, addr):
    if level > cache_levels: return

    计算当前级的 seti 和 tag

    if hit:
        统计 hits，更新 LRU
        if isWrite: dirty = true
        return

    // miss
    统计 misses
    recursivecache(level+1, false, false, addr)  // 先去下一级 fetch

    // 递归返回后，在当前级装入数据
    选一个 way（lru_way）
    处理 evict
    装入新数据
```

###  hit_way 函数

一开始容易想到的就是统计hit时只需要遍历每一路找到就hit，但是我们会发现这需要我们事先知道level，然后才能确定是在那一层遍历，并且每一级cache的参数不一样，于是我们只能将这个找hit的过程抽象成一个函数

显然我们需要知道level,addr,并且由于L1有两种情况，我们还必须知道是否是’I‘指令或是其他，所以还需要一个isInstr的参数

```c
int hit_way(int level, bool isInstruction, uint64_t addr);
// 返回命中的 way 下标，miss 返回 -1
```

最开始想的是返回 `bool`判断是否hit，但后来发现 hit 之后需要知道是哪个 way 才能更新 LRU，所以改成返回 way 下标。

这个函数只负责"查找"，不做任何统计和状态修改。统计放在 `recursivecache` 里做。

例如L1I时：
```c
for (int i = 0; i < L1_LINE_NUM; i++) {
    if (l1icache[seti][i].valid && l1icache[seti][i].tag == tag) {
        return i;
    }
}
return -1;  // 所有 way 都没命中
```
---
### LRU 时钟

`latest_used` 字段用来实现 LRU，需要一个**全局时钟**：

```c
static uint64_t LRUtime = 0;
```

每次访问一个 cache line 时，把当前时钟值写入 `latest_used`，然后时钟自增：

```c
cache[seti][way].latest_used = LRUtime++;
```

**不能对每个 line 单独自增**，那样就没法比较不同 line 之间谁更旧了。

事实上文档中还提到可以用一个time的库函数维护，但笔者由于不太熟悉并没有尝试

---
### lru_way 函数
在加载一条cache line时，你需要在当前cache set中找出一条可用的cache line。换句话说，你需要找到一条valid字段为false的cache line。如果有多条可用的cache line，你需要选择下标最小的一个。

于是我们设计一个函数用于选 way ，逻辑：
1. 先找有没有 invalid 的 way，有的话选**下标最小**的
2. 没有的话，找 `latest_used` 最小的 way（LRU），返回那个下标

```c
int lru_way(int level, bool isInstruction, uint64_t seti) {
    // 优先找 invalid way（下标最小）
    for (int i = 0; i < ways; i++) {
        if (!cache[seti][i].valid) return i;
    }
    // 找 LRU
    int lrui = 0;
    for (int i = 1; i < ways; i++) {
        if (cache[seti][i].latest_used < cache[seti][lrui].latest_used) {
            lrui = i;
        }
    }
    return lrui;
}
```

**重要：lru_way 不能重复调用！**

```c
// 错误示范
l1icache[seti][lru_way(level, isInstruction, seti)].valid = true;
l1icache[seti][lru_way(level, isInstruction, seti)].tag   = tag;
l1icache[seti][lru_way(level, isInstruction, seti)].latest_used = LRUtime++;
```

问题是第一次调用把 valid 置为 true 之后，第二次调用可能返回不同的 way（因为 invalid way 的情况变了）。

必须先保存结果：

```c
int lruway = lru_way(level, isInstruction, seti);
l1icache[seti][lruway].valid       = true;
l1icache[seti][lruway].tag         = tag;
l1icache[seti][lruway].latest_used = LRUtime++;
```

---
### Evict 的处理

`lru_way` 返回的 way，如果它原本 `valid=true`，说明发生了 conflict miss，需要：
1. `evictions++`
2. 如果 `dirty=true`，把数据写回下一级

```c
int lruway = lru_way(level, isInstruction, seti);
if (l1dcache[seti][lruway].valid) {
    l1d_evictions++;
    if (l1dcache[seti][lruway].dirty) {
        // 重建地址，写回下一级（把这行脏数据写回它原来的内存地址）
        writeback(2, l1dcache[seti][lruway].tag << 5) | (seti << 3);
    }
}
// 装入新数据
l1dcache[seti][lruway].valid       = true;
l1dcache[seti][lruway].tag         = tag;
l1dcache[seti][lruway].dirty       = isWrite;
l1dcache[seti][lruway].latest_used = LRUtime++;
//把刚才腾出来的行，标记为有效，存入新数据的 tag。
//刚装进来的新数据，更新LRU
```

**重建地址的公式**：

```c
// L1 （offset=3, set=2）
L1_addr = (tag << 5) | (seti << 3)

// L2 （offset=3, set=3）
L2_addr = (tag << 6) | (seti << 3)

// L3 （offset=4, set=4）
L3_addr = (tag << 8) | (seti << 4)
```

offset 部分补 0，因为我们模拟的是 cache line 级别的操作，不需要关心 block 内偏移。

**evictions 的含义**：统计的是 conflict miss 次数，不是 cache line 发生 evict 的次数。back invalidation 时 evict 的 line 不计入 evictions（因为这属于invalidate）。

---
### writeback 函数

当 dirty line 被 evict 时，需要把数据写回下一级。

最开始我直接用 `recursivecache` 来写回，但这样会导致 hit/miss/evict 统计出错——writeback不需要重新走完整个流程

所以专门写了一个 `writeback` 函数，只更新 dirty 位和 LRU，不做其他任何统计：

```c
void writeback(int level, uint64_t addr) {
    int way = hit_way(level, false, addr);
    if (way != -1) {
        if (level == 2) l2_hits++;  // 这里要统计 hit！
        if (level == 3) l3_hits++;
        // 更新 dirty 和 LRU
        cache[seti][way].dirty       = true;
        cache[seti][way].latest_used = LRUtime++;
    }
}
```

**注意：writeback 函数里需要统计 hit！**

这是一个非常容易漏掉的地方。当 L1D evict 一个 dirty line，写回到 L2 时，这次对 L2 的访问一定会 hit（inclusive 保证 100% 命中），需要统计进 L2 hits。L3同理

---
### fetch-before-evict

有一个很重要的顺序：**先去下一级 fetch 数据，再选 way 并 evict**。

```c
// 正确顺序
recursivecache(level+1, false, false, addr);  // 先 fetch
int lruway = lru_way(...);                   
if (valid) { evict... }                       // 再 evict
// 装入新数据
```

为什么要先 fetch 再 evict？因为 LRU 时钟的顺序会影响结果。先 fetch 会更新下一级的 LRU 时间戳，如果先 evict 再 fetch，时间戳顺序不同，后续的 LRU 选择可能出错。

---

### isWrite 参数：

我们首先需要思考：**dirty 位什么时候置 1，什么时候清 0？**

容易想到逻辑是这样的：

**dirty=1 的含义**：这个 cache line 被修改过，和下一级的数据不一致，evict 时需要写回。

**什么时候置 1**：只有**写操作（Store）**命中或装入时。

**什么时候置 0**：装入新 line 时初始 dirty=0

这样我们设置dirty时就可以设计为： `dirty = isWrite`——如果是 Store 就是 1，如果是 Load 就是 0。

向下 fetch 时，`isWrite` 始终传 `false`，因为 fetch 本身是读操作：

```c
recursivecache(level+1, false, false, addr);  // 注意第三个参数是 false
```

**M 操作的处理**：M = Load + Store，所以调用两次：

```c
case 'M':
    recursivecache(1, false, false, addr);  // Load
    recursivecache(1, false, true,  addr);  // Store（第二次必然 hit）
    break;
```

第二次调用时，数据已经在 L1 里了（第一次装入），所以直接 hit，把 dirty 置 1。

---

### seti 和 tag 必须是局部变量


我最开始把 `seti` 和 `tag` 定义为全局变量。问题是，`recursivecache` 是递归函数，当 L1 miss 调用 `recursivecache(2, ...)` 时，L2 会把 `seti` 和 `tag` 改成 L2 的值，递归返回后 L1 用的 `seti` 和 `tag` 已经是 L2 的了，完全算错。

**必须改成局部变量**：

```c
void recursivecache(int level, bool isInstruction, bool isWrite, uint64_t addr) {
    uint64_t seti;  // 局部变量！
    uint64_t tag;   // 局部变量！
    if (level > cache_levels) return;
    if (level == 1) { seti = (addr >> 3) & 0x3; tag = addr >> 5; }
    if (level == 2) { seti = (addr >> 3) & 0x7; tag = addr >> 6; }
    if (level == 3) { seti = (addr >> 4) & 0xf; tag = addr >> 8; }
    // ...
}
```

这样可以保证每次递归调用都会有自己的一套局部变量，互不干扰。

---

**事实上做完这些已经能拿到434分了（没有考虑bcak invalidation）**

---


## Back Invalidation

这是整个 lab 最难的部分。

**为什么需要 back invalidation？**

L2 是 inclusive 的，意味着 L1 里有的数据，L2 里一定也有。当 L2 要 evict 一个 line 时，L1 里可能还有这个数据的副本。如果不删掉 L1 里的副本，L1 有数据但 L2 没有，inclusive 性质就被破坏了。

**back invalidation 的顺序**：

必须**先处理高级（L1），再处理低级（L2）**。

原因：如果 L1D 里这条 line 是 dirty 的，需要先把数据 writeback 到 L2，这时 L2 的 line 必须还是 valid 的。所以一定要先处理 L1（可能触发 writeback 到 L2），再 invalidate L2。

**level==2 evict 时**：

```c
void backinvalidation(int level, uint64_t addr) {
    if (level == 1) return;
    if (level == 2) {
        // 检查 L1D
        int way_d = hit_way(1, false, addr);
        if (way_d != -1) {
            uint64_t seti = (addr >> 3) & 0x3;
            if (l1dcache[seti][way_d].dirty) {
                writeback(2, addr);  // 先 writeback 到 L2
            }
            l1dcache[seti][way_d].valid = false;
            l1dcache[seti][way_d].dirty = false;
        }
        // 检查 L1I（L1I 不会 dirty，直接 invalidate）
        int way_i = hit_way(1, true, addr);
        if (way_i != -1) {
            uint64_t seti = (addr >> 3) & 0x3;
            l1icache[seti][way_i].valid = false;
        }
    }
    // ...
}
```

为什么要同时检查 L1D 和 L1I？因为 L2 是 unified cache，同时存指令和数据，L2 里的某个地址可能来自 L1D，也可能来自 L1I。

**level==3 evict 时**：

L3 line 是 16B，L2 line 是 8B，一个 L3 line 覆盖的地址范围在 L2 里对应**两条** line。

比如 L3 evict 地址 `0x00` 的 line，这 16 个字节在 L2 里被分成：
- L2 line1：地址 `0x00`（覆盖 `[0x00, 0x08)`）
- L2 line2：地址 `0x08`（覆盖 `[0x08, 0x10)`）

所以 L3 evict 时需要对两个地址各处理一次：

```c
if (level == 3) {
    // 先处理 L1（通过对两个 L2 地址各调用一次 level==2 的逻辑）
    backinvalidation(2, addr);      // 删 L1 里 addr 的副本
    backinvalidation(2, addr + 8);  // 删 L1 里 addr+8 的副本

    // 再处理 L2
    // addr 对应的 L2 line
    int way = hit_way(2, false, addr);
    if (way != -1) {
        uint64_t seti = (addr >> 3) & 0x7;
        if (l2ucache[seti][way].dirty) writeback(3, addr);
        l2ucache[seti][way].valid = false;
        l2ucache[seti][way].dirty = false;
    }
    // addr+8 对应的 L2 line
    int way8 = hit_way(2, false, addr + 8);
    if (way8 != -1) {
        uint64_t seti8 = ((addr + 8) >> 3) & 0x7;
        if (l2ucache[seti8][way8].dirty) writeback(3, addr + 8);
        l2ucache[seti8][way8].valid = false;
        l2ucache[seti8][way8].dirty = false;
    }
}
```

**back invalidation 不计入 evictions**：evictions 只统计 conflict miss（LRU 驱逐），back invalidation 是不算在内。


在 `recursivecache` 的 miss 分支里，evict 时调用 `backinvalidation`：

```c
// L2 evict 时
if (l2ucache[seti][lruway].valid) {
    l2_evictions++;
    uint64_t victim_addr = (l2ucache[seti][lruway].tag << 6) | (seti << 3);
    backinvalidation(2, victim_addr);  // 先删 L1 里的副本
    if (l2ucache[seti][lruway].dirty) {
        writeback(3, victim_addr);     // 再写回 L3
    }
}
```

顺序：**backinvalidation → writeback → 装入新数据**。

---

### 主函数

`cacheAccess` 作为入口：

```c
void cacheAccess(char op, uint64_t addr, uint32_t len) {
    if (op == 'I')
        recursivecache(1, true,  false, addr);
    else if (op == 'L')
        recursivecache(1, false, false, addr);
    else if (op == 'S')
        recursivecache(1, false, true,  addr);
    else if (op == 'M') {
        recursivecache(1, false, false, addr);  // Load
        recursivecache(1, false, true,  addr);  // Store
    }
}
```
事实上对于M操作我们只需要做一次L做一次S即可

---
于是我们得到最终完整代码：
---
```c
#include "cachelab.h"
#include <stdint.h>
// feel free to include any files you need above

int l1d_hits = 0;
int l1d_misses = 0;
int l1d_evictions = 0;
int l1i_hits = 0;
int l1i_misses = 0;
int l1i_evictions = 0;
int l2_hits = 0;
int l2_misses = 0;
int l2_evictions = 0;
int l3_hits = 0;
int l3_misses = 0;
int l3_evictions = 0;
int cache_levels = 0;

static uint64_t LRUtime = 0;


int hit_way(int level,bool isInstruction,uint64_t addr){
    uint64_t seti;
    uint64_t tag;
    if(level==1) seti=(addr>>3)&0x3;
    if(level==1) tag=(addr>>5);
    if(level==2) seti=(addr>>3)&0x7;
    if(level==2) tag=(addr>>6);
    if(level==3) seti=(addr>>4)&0xf;
    if(level==3) tag=(addr>>8);
    if(level==1&&isInstruction){
      for(int i=0;i<L1_LINE_NUM;i++){
        if(l1icache[seti][i].valid && l1icache[seti][i].tag==tag){
        
        return i;
      }
    }
    return -1;
  }
  
    else if(level==1&&!isInstruction){
      for(int i=0;i<L1_LINE_NUM;i++){
        if(l1dcache[seti][i].valid && l1dcache[seti][i].tag==tag){
        return i;
      }
  }
  return -1;
  }
    else if(level==2){
      for(int i=0;i<L2_LINE_NUM;i++){
        if(l2ucache[seti][i].valid && l2ucache[seti][i].tag==tag){
        return i;
      }
  }
  return -1;
  }
    else if(level==3){
      for(int i=0;i<L3_LINE_NUM;i++){
        if(l3ucache[seti][i].valid && l3ucache[seti][i].tag==tag){
        return i;
      }
    }
    return -1;
  }
  return -1;
}

int lru_way(int level,bool isInstruction,uint64_t seti){
  int lrui=0;
  if(level==1&&isInstruction){
    for(int i=0;i<L1_LINE_NUM;i++){
      if(!l1icache[seti][i].valid){
        return i;
      }
    }
    for(int i=0;i<L1_LINE_NUM;i++){
      if(l1icache[seti][i].latest_used<l1icache[seti][lrui].latest_used){
        lrui=i;
      }
    }
    return lrui;
  }
  else if(level==1&&!isInstruction){
    for(int i=0;i<L1_LINE_NUM;i++){
      if(!l1dcache[seti][i].valid){
        return i;
      }
    }
    for(int i=0;i<L1_LINE_NUM;i++){
      if(l1dcache[seti][i].latest_used<l1dcache[seti][lrui].latest_used){
        lrui=i;
      }
    }
    return lrui;
  }
  else if(level==2){
    for(int i=0;i<L2_LINE_NUM;i++){
      if(!l2ucache[seti][i].valid){
        return i;
      }
    }
    for(int i=0;i<L2_LINE_NUM;i++){
      if(l2ucache[seti][i].latest_used<l2ucache[seti][lrui].latest_used){
        lrui=i;
      }
    }
    return lrui;
  }
  else if(level==3){
    for(int i=0;i<L3_LINE_NUM;i++){
      if(!l3ucache[seti][i].valid){
        return i;
      }
    }
    for(int i=0;i<L3_LINE_NUM;i++){
      if(l3ucache[seti][i].latest_used<l3ucache[seti][lrui].latest_used){
        lrui=i;
      }
    }
    return lrui;
  }
  return -1;
}
void writeback(int level, uint64_t addr) {
    int way = hit_way(level, false, addr);
    if (way != -1) {
        if(level==1) {
            l1d_hits++;
            l1dcache[((addr>>3)&0x3)][way].dirty=true;
            l1dcache[((addr>>3)&0x3)][way].latest_used=LRUtime++;
        }
        if(level==2) {
            l2_hits++;
            l2ucache[((addr>>3)&0x7)][way].dirty=true;
            l2ucache[((addr>>3)&0x7)][way].latest_used=LRUtime++;
        }
        if(level==3) {
            l3_hits++;
            l3ucache[((addr>>4)&0xf)][way].dirty=true;
            l3ucache[((addr>>4)&0xf)][way].latest_used=LRUtime++;
        }
    }
}


void backinvalidation(int level, uint64_t addr) {
    if (level == 1) return;
    if (level == 2) {
        int way_d = hit_way(1, false, addr);
        if (way_d != -1) {
            uint64_t seti = (addr >> 3) & 0x3;
            if (l1dcache[seti][way_d].dirty) {
                writeback(2, addr);
            }
            l1dcache[seti][way_d].valid = false;
            l1dcache[seti][way_d].dirty = false;
        }
        int way_i = hit_way(1, true, addr);
        if (way_i != -1) {
            uint64_t seti = (addr >> 3) & 0x3;
            l1icache[seti][way_i].valid = false;
        }
    }
    if (level == 3) {
    backinvalidation(2, addr);    
    backinvalidation(2, addr + 8); 
    int way = hit_way(2, false, addr);
    if(way != -1) {
        uint64_t seti = (addr >> 3) & 0x7;
        if (l2ucache[seti][way].dirty) {
            writeback(3, addr);
        }
        l2ucache[seti][way].valid = false;
        l2ucache[seti][way].dirty = false;
    }
   
    int way8 = hit_way(2, false, addr + 8);
    if(way8 != -1) {
        uint64_t seti8 = ((addr + 8) >> 3) & 0x7;
        if (l2ucache[seti8][way8].dirty) {
            writeback(3, addr + 8);
        }
        l2ucache[seti8][way8].valid = false;
        l2ucache[seti8][way8].dirty = false;
}
}
}
  


void recursivecache(int level, bool isInstruction, bool isWrite, uint64_t addr) {
    uint64_t seti;
    uint64_t tag;
    if (level > cache_levels) return;  
    if(level==1) {
        seti=(addr>>3)&0x3;
        tag=(addr>>5);
    }
    if(level==2) {
        seti=(addr>>3)&0x7;
        tag=(addr>>6);
    }
    if(level==3) {
        seti=(addr>>4)&0xf;
        tag=(addr>>8);
    } 
    int hitway=hit_way(level,isInstruction,addr);
    if(hitway!=-1){
      if(level==1&&isInstruction) {
        l1i_hits++;
        l1icache[seti][hitway].latest_used=LRUtime++;

      }
      else if(level==1&&!isInstruction){
        l1d_hits++;
        l1dcache[seti][hitway].latest_used=LRUtime++;
        if(isWrite){
          l1dcache[seti][hitway].dirty=true;
        }
      }
      else if(level==2){
        l2_hits++;
        l2ucache[seti][hitway].latest_used=LRUtime++;
        if(isWrite){
          l2ucache[seti][hitway].dirty=true;
        }
      }
      else if(level==3){
        l3_hits++;
        l3ucache[seti][hitway].latest_used=LRUtime++;
        if(isWrite){
          l3ucache[seti][hitway].dirty=true;
        }
    }
    return;
  }
    if(hitway==-1){
      if(level==1&&isInstruction) {
        l1i_misses++;
        recursivecache(level+1,false,false,addr);
        int lruway=lru_way(level,isInstruction,seti);
        if(l1icache[seti][lruway].valid){
          l1i_evictions++;
        }
        l1icache[seti][lruway].valid=true;
        l1icache[seti][lruway].tag=tag;
        l1icache[seti][lruway].dirty=false;
        l1icache[seti][lruway].latest_used=LRUtime++;
    }
      else if(level==1&&!isInstruction){
        l1d_misses++;
        recursivecache(level+1,false,false,addr);
        int lruway=lru_way(level,isInstruction,seti);
        if(l1dcache[seti][lruway].valid){
          l1d_evictions++;
          if(l1dcache[seti][lruway].dirty){
            writeback(level+1,(l1dcache[seti][lruway].tag<<5)|(seti<<3));
          }
        }
        l1dcache[seti][lruway].valid=true;
        l1dcache[seti][lruway].tag=tag;
        l1dcache[seti][lruway].dirty=isWrite;
        l1dcache[seti][lruway].latest_used=LRUtime++;
    }
      else if(level==2){
        l2_misses++;
        recursivecache(level+1,false,false,addr);
        int lruway=lru_way(level,isInstruction,seti);
        if(l2ucache[seti][lruway].valid){
          l2_evictions++;
          backinvalidation(2,(l2ucache[seti][lruway].tag<<6)|(seti<<3));
          if(l2ucache[seti][lruway].dirty){
            writeback(level+1,(l2ucache[seti][lruway].tag<<6)|(seti<<3));
          }
        }
        l2ucache[seti][lruway].valid=true;
        l2ucache[seti][lruway].tag=tag;
        l2ucache[seti][lruway].dirty=isWrite;
        l2ucache[seti][lruway].latest_used=LRUtime++;
    }
      else if(level==3){
        l3_misses++;
        recursivecache(level+1,false,false,addr);
        int lruway=lru_way(level,isInstruction,seti);
        if(l3ucache[seti][lruway].valid){
          l3_evictions++;
          backinvalidation(3,(l3ucache[seti][lruway].tag<<8)|(seti<<4));
          if(l3ucache[seti][lruway].dirty){
            writeback(level+1,(l3ucache[seti][lruway].tag<<8)|(seti<<4));
          }
        }
        l3ucache[seti][lruway].valid=true;
        l3ucache[seti][lruway].tag=tag;
        l3ucache[seti][lruway].dirty=isWrite;
        l3ucache[seti][lruway].latest_used=LRUtime++;
    }
  }
}


// you can add your own data structures and functions below

// you are not allowed to modify the declaration of this function
void cacheInit(int levels) {
  cache_levels = levels;  
  for(int i=0;i<L1_SET_NUM;i++){
    for(int j=0;j<L1_LINE_NUM;j++){
      l1dcache[i][j].valid = false;
      l1dcache[i][j].dirty = false;
      l1dcache[i][j].tag = 0;
      l1dcache[i][j].latest_used = 0;
      l1icache[i][j].valid = false;
      l1icache[i][j].dirty = false;
      l1icache[i][j].tag = 0;
      l1icache[i][j].latest_used = 0;
    } 
   }
   if (cache_levels ==1) return;
   for(int i=0;i<L2_SET_NUM;i++){
    for(int j=0;j<L2_LINE_NUM;j++){
      l2ucache[i][j].valid = false;
      l2ucache[i][j].dirty = false;
      l2ucache[i][j].tag = 0;
      l2ucache[i][j].latest_used = 0;
    } 
   }
    if (cache_levels ==2) return;
    for(int i=0;i<L3_SET_NUM;i++){
    for(int j=0;j<L3_LINE_NUM;j++){
      l3ucache[i][j].valid = false;
      l3ucache[i][j].dirty = false;
      l3ucache[i][j].tag = 0;
      l3ucache[i][j].latest_used = 0;
    }
}
}

// you are not allowed to modify the declaration of this function
void cacheAccess(char op, uint64_t addr, uint32_t len) {
   if(op=='I'){
    recursivecache(1,true,false,addr);
   }
    else if(op=='L'){
      recursivecache(1,false,false,addr);
    }
    else if(op=='S'){
      recursivecache(1,false,true,addr);
    }
    else if(op=='M'){
      recursivecache(1,false,false,addr);
      recursivecache(1,false,true,addr);
    }

}

```
事实上写完代码直接就拿到了满分，还是很惊讶的，因为写的过程非常痛苦（最痛苦的是一开始一直没有搞懂题目要干什么，后来开始写才慢慢体会到模拟cache的意思），糊里糊涂（一步步按照需要的功能一点点实现）竟然就完成了partA，但回过头看好像又没有非常困难的地方了。

由于笔者实力有限，写出的代码非常的amateur,里面大量相同结构的代码应该还有很大优化空间，~~由于去享受五一假期~~，后面有时间再优化一下吧。
## something terrible

### Bug ：全部输出 0

最开始跑出来所有统计量都是 0，原因是编译没有更新  ：）

解决：`make clean && make`。


---

# 思考题

 **Question:** 在这个实验中一直强调的一个点是Inclusive policy，这种设计方法在以前的CPU，特别是Intel的CPU中很常见，但其实现代的CPU以及逐渐转向使用NINE模式，因此会产生以下问题：

    - 使用Inclusive policy的缓存必须满足什么条件？这样设计的优缺点分别是什么？
    - NINE策略不要求低级cache强制包含高级cache内容，这样做相比inclusive的好处和坏处分别是什么？
    - 本次实验实际上借助inclusive的性质大大简化了设计，如果采用NINE结构，你将如何调整你的代码？

**Answer：**  

Inclusive 缓存策略必须满足的条件：
- 高阶缓存（L1）中的所有数据，必须同时存在于低阶共享缓存（L2/L3）中
- 当低阶缓存驱逐某一数据时，必须先无效（invalidate）高阶缓存中对应的副本
- 写回、替换操作必须严格遵守包含关系，不允许出现 L1 有、L2 无一类的情况

优点：
- 无需查询低层 L1数据，只需查询共享 L2/L3 上
- 实现简单，如本次实验，可直接确定写回必然命中

缺点：
- 空间利用率低：L2/L3 必须冗余存储 L1 数据，有效容量减小
- 替换操作复杂：替换时需要同步无效高阶缓存，增加操作流程

NINE（Non-Inclusive, Non-Exclusive）策略

定义：不要求低阶缓存包含高阶缓存，也不要求高阶缓存数据独有的，两级缓存可以部分重叠

相比 Inclusive 的优势：
- 空间利用率最大化：L2/L3 不强制备份 L1 数据，可缓存更多活跃数据
- 替换灵活：L2 替换数据时，无需同步操作 L1，减少延迟


劣势：
- 无法利用inclusive的特性只在高层查询就确定低层的情况
- 缺失处理复杂：L2 缺失时，无法确定 L1 是否持有数据
- 设计可能也要更复杂  ~~（没有规矩，不成方圆）~~
  

 实验从 Inclusive 改为 NINE 的代码调整:
 
 删除包含关系强制校验：不再保证 L1 数据一定存在于 L2；修改 writeback 逻辑：写回时 L2 不一定命中，不能直接 l2_hits++；修改缺失流程：L2 缺失时，需要检查 L1 是否存在副本；修改替换逻辑：L2 替换数据时，无需主动无效 L1
  



 **Question:** 现代CPU几乎都采用L1D和L1I两种缓存结构，而在L2及更低级的缓存使用统一指令和数据的方式，这么做的好处是什么？
 
 **Answer：**  
- 并行访问：取指（L1I）和数据读写（L1D）可同时执行，无结构冲突
- 优化设计：指令缓存只读，无需 dirty 位、写回逻辑；数据缓存支持写操作
- 降低复杂度：L1 规模小，分离设计不占用过多面积
- L2 统一利用空间：统一缓存可动态分配空间给指令 / 数据，空间利用率更高
- 功耗优化：L1 小规模分离设计，访问功耗更低



 **Question:**  你觉得CPU是如何区分指令内存和数据内存的访问的？

 **Answer：**  
- 硬件来源区分
  - 取指阶段：PC 指针 发出的地址 → 指令访问
  - 执行阶段：load/store 指令 发出的地址 → 数据访问
- 总线 / 接口区分：CPU 内部使用独立的指令、数据通路
- 缓存标识：L1I 和 L1D 为独立硬件，天然隔离访问类型
- 权限区分：指令内存通常只读、不可执行保护；数据内存可读写




**Question:** 本次实验要求实现严格的LRU算法，一种暴力实现方式是遍历所有cache line, 这样时间复杂度为$O(E)$，你可以设计一种复杂度为$O(1)$的实现方式吗

 **Answer：** 
- 双向链表
    - 队头：最近刚使用的块
    - 队尾：最久未使用的块（LRU，要被淘汰）
    - 任意结点可以 O(1) 摘除、插到头部 

- 哈希 / 数组映射
  
    通过块号，O(1) 直接找到对应链表结点，不用遍历。



**Question:** LRU算法在某种特定的情形下会造成100% miss，你可以发现这种访问模式吗？

**Answer：** 
循环访问，工作集 > 缓存容量

当缓存只能放下 k 个块，持续按顺序访问b1​,b2​,…,bk​,bk+1​,b1​,b2​,b3​…每一个新块都不在缓存里，每次都要触发替换，命中率 = 0，100% miss。

**Question:** 实际硬件中，实现LRU算法其实十分昂贵，因此大多数厂家采用近似LRU的方法，如果让你设计，你会如何设计这种算法？

**Answer：** 

实际使用中使用比较多的是用二叉树：

原理： 使用一颗完全二叉树记录访问历史。对于N个Way（数据块），只需要N-1个比特位。

机制： 每个节点用1个bit表示最近“左”还是“右”被访问。当需要替换时，根据节点bit指向相反的方向找到最久未使用的路径。

我想到的办法就是只标记最新的，替换时只要不是最新的都可以替换（但这种方式应该精度很差）

**Question:** 本次实验中在实现上有个小细节是，在发生conflict miss时，我们总是先从下一级fetch数据，然后再判断是否需要evict，这样做的好处和不足是什么？如果上述两个操作的流程互换之后，带来的好处和坏处是什么？你可能需要综合考虑inclusive policy带来的影响。

**Answer：** 
这一点我们在设计代码时就讨论过：因为 LRU 时钟的顺序会影响结果。先 fetch 会更新下一级的 LRU 时间戳，如果先 evict 再 fetch，时间戳顺序不同，后续的 LRU 选择可能出错。

优点自然是符合inclusive policy，并且数据不会出错，保证正确性；缺点是先fetch会有一定的资源占用、增加延迟等问题
如果互换流程优缺点也是互换


**Question:** 进行cache访问时，需要根据内存地址提取出tag，set等字段，而CPU产生的地址实际上都是虚拟地址，需要额外的机制转换成物理地址（详见虚拟内存章节）。因此，cache的设计实际上可以分成physical index和virtual index两种方式，即采用物理地址或者虚拟地址两种地址解析tag，set等内容，那么：
- 使用physical index的cache的优缺点是什么？
- 使用virtual index的cache的优缺点是什么？
- 你能不能设计一种方法综合利用上述两种方式各自的优势？

**Answer：** 

Physical Index（物理地址索引）

优点：无虚拟地址别名问题，简单；无需担心进程切换导致缓存失效

缺点：必须先做地址转换（TLB），访问延迟高；硬件时序紧张，设计难度大

Virtual Index（虚拟地址索引）

优点：缓存访问与 TLB 转换并行，速度极快；降低硬件时序压力

缺点：存在虚拟地址别名问题：多个虚拟地址映射同一物理地址；进程切换必须清空缓存，性能损耗大

综合优化方案：VIPT（虚拟索引物理标签）
- 索引用虚拟地址：并行访问缓存与 TLB
- 标签用物理地址：避免别名问题
- 兼顾速度与正确性


**Question:** 本次实验中实现的模拟器只能应对顺序访问，如果需要扩展你的模拟器以支持多个线程并发访问，你该如何调整现有的代码？

**Answer：** 可能需要修改对hit，miss等的记数，以及维护LRU的操作也要修改

**Question:** 本次实验中不要求考虑多核之间的一致性问题，如果考虑多核之间一致性的问题，且L3作为多核之间的共享缓存，你该如何调整现有的代码？

**Answer：** 
    无效化机制：多核修改数据时，无效其他核心的缓存副本；确保数据修改对所有核心可见


**Question:** 在考虑多核之间cache一致性的前提下，如果需要将inclusive策略变成NINE策略，你需要如何改进现有的代码？


**Answer：** 
    删除包含关系维护：L3 替换无需无效 L1/L2；全核心监听：一致性操作必须广播到所有私有缓存；独立替换逻辑：L1/L2/L3 可独立替换数据；目录协议优化：用目录记录数据位置，替代监听；写回策略重构：不再依赖下级缓存必然命中
    缺失处理增强：访问缺失时，需查询所有核心缓存

# Cache Lab Part B 解题过程记录



##  写在前面

Part B 要求在 `trans.c` 中实现一个矩阵转置函数，尽可能减少 Cache Miss 次数。

测试用的 Cache 配置固定为 **(s=5, E=1, b=5)**：
- 直接映射（每个 set 只有 1 个 way）
- 32 个 set
- 每个 cache line 32B，可以装 **8 个 int**
- 总大小 1KB

需要优化三个测试用例：
- 32×32：miss < 300 满分
- 64×64：miss < 1300 满分
- 61×67：miss < 2000 满分

---

##  理解 Cache 结构

首先搞清楚一个 cache line 能装 8 个 int 意味着什么。

当读 `A[i][0]` 时，`A[i][1]` 到 `A[i][7]` 也会被顺带装进 cache（同一个 cache line）。所以**如果接下来马上用到这 8 个数，就是 7 次 hit**。

但如果读完 `A[i][0]` 就去干别的事，等回来的时候 cache line 可能已经被换出了，之前装进来的 7 个数就白装了。

**关键结论：要充分利用空间局部性，尽量连续访问同一个 cache line 的数据。**

---

##  简单转置Miss分析(以32*32为例)

最简单的转置：

```c
for(int i = 0; i < N; i++)
    for(int j = 0; j < M; j++)
        B[j][i] = A[i][j];
```

**A 矩阵**按行读，每行第一个元素 miss，后续 7 个 hit。32 行共 **128 次 miss**。

**B 矩阵**按列写（`B[j][i]` 是列优先），每次写都跨越一整行，每次都 miss。32 列共 **1024 次 miss**。

合计约 **1152 次**，实际测出 1184 次，多出 32 次来自对角线的特殊情况。

---

### 对角线 miss

A 和 B 在内存里紧挨着，B 的起始地址 = A 的起始地址 + 32×32×4 = A + 4096 字节。

Cache 总大小 = 32 × 32 = 1024 字节。

A 和 B 相差 4096 = 4 × 1024 字节，正好是 cache 大小的整数倍。所以 **A[i][j] 和 B[i][j] 映射到完全相同的 set**！

地址的 set index 计算：`set = (addr / 32) % 32`

- 第一个 32 是 line size（b=5，offset 5 位）
- 第二个 32 是 set 数（s=5，set index 5 位）

A 和 B 相差 4096 / 32 = 128，128 % 32 = 0，所以 set index 完全相同。

**对角线块的问题**：处理 `i==j` 的元素时，`A[i]` 和 `B[i]` 在同一个 set。写 `B[i][0]` 会驱逐 `A[i]` 这行，下次读 `A[i][1]` 又要 miss，产生额外的冲突 miss。

以 i=0 这一行为例：
```
读 A[0][0]：miss，把 A[0][0..7] 装入 set X
写 B[0][0]：miss，把 B[0][0..7] 装入 set X，把 A[0][0..7] 驱逐了
读 A[0][1]：**又 miss 了！**因为刚才 A 的 cache line 被 B 驱逐了
```
所以对角线上每处理一个元素，A 和 B 会互相驱逐，多出额外的 miss。非对角线的行不存在这个问题，因为 A[i] 和 B[j]（j≠i）不在同一个 set。
32 行对角线，每行多出约 1 次额外 miss，所以多出大约 32 次，1152 + 32 = 1184。



---



##  32×32 的优化

### 8x8分块
实验中的Cache，通常只能保存下32 * 8个int。为了可以减少这种Capacity Misses，你可以尝试缩小你的求解问题的规模，大问题转化为小问题，大矩阵转化为几个小矩阵

如果不是一个元素一个元素地转置，而是一次处理一个 8×8 的小块，会发生什么？

对于一个 8×8 的矩阵，B 的这 8 列，每行 8 个元素正好是一个 cache line。
所以写 B 这个 8×8 块时，是写 B 的 8 行，每行第一次写会 miss（第一列元素写入miss，但会将这一行元素（刚好在一个cacheline）全部放进cache），之后 7 次都是 hit。
也就是写 B 只有 8 次 miss，不是 64 次！
所以一个 8×8 的块：读 A 8 次 miss，写 B 8 次 miss，总共 16 次 miss。

为什么是8*8

Cache 总共 32 个 cache line，A 和 B 各占一半比较合理，也就是各用 16 个 cache line。

- 一个 cache line 装 8 个 int
- 16 个 cache line 装 128 个 int = 8×8 的两份

所以切成 8×8，A 的一个块占 8 个 cache line，B 的一个块也占 8 个 cache line，加起来 16 个，只用了 cache 的一半，剩下一半有余量，冲突少。

如果切成 16×8，A 占 16 个，B 占 16 个，把整个 cache 占满，A 和 B 会互相驱逐，效果很差。

当然还有原本矩阵是32*32,这样分非常的规整，也比较简单



8×8 分块后：得到**344**次miss

比最简单形式的 1184 次少很多，但还是超过 300 的目标。（经过前面的分析，我们容易知道，现在对于Complusory Miss、Capacity Misses已经比较难优化了，miss大多来自于对角线引发的Conflict Misses，我们需要考虑如何消除对角线引发的miss）

### 用局部变量消除对角线冲突


对角线块的问题是 ：A与B对角线上的块在缓存中对应的位置是相同的，所以复制过程中会发生相互冲突，A 和 B 互相驱逐。解决方法：**把 A 的一整行 8 个值先存到局部变量，再写 B**。（为什么可行：读入A每一行的第一个元素后，这一行的元素都会载入缓存，我们可以用临时变量存下这 8 个元素，之后再传给B，这样就避免了第一个元素复制时，B把A的缓冲行驱逐，导致没有利用上A的缓冲。事实上用临时变量程序还会因为使用寄存器而提高程序的性能）

```c
for(int u = i; u < i+8; u++) {
    int tmp0=A[u][j];
                int tmp1=A[u][j+1];
                int tmp2=A[u][j+2];
                int tmp3=A[u][j+3];
                int tmp4=A[u][j+4];
                int tmp5=A[u][j+5];
                int tmp6=A[u][j+6];
                int tmp7=A[u][j+7];
                B[j][u]=tmp0;
                B[j+1][u]=tmp1;
                B[j+2][u]=tmp2;
                B[j+3][u]=tmp3;
                B[j+4][u]=tmp4;
                B[j+5][u]=tmp5;
                B[j+6][u]=tmp6;
                B[j+7][u]=tmp7;

}
```

读 A 时，第一次 miss 把整行 8 个装入 cache，后续 7 次全 hit，**只有 1 次 miss**。然后 A 的值已经在局部变量里，B 怎么驱逐 A 都无所谓了。

最终 miss 数：**288,满足 < 300 的要求**。

事实上这个问题应该是存在理论最优解的：矩阵 A[32][32],B[32][32]每个矩阵占用：32×32=1024 个 int每 8 个 int 占一条 CacheLine；单矩阵占用 CacheLine 数量：1024/8=128 条；也就是只读 A、只写 B，最少必须发生：128+128=256 次强制 Miss ，这里笔者没有进行深入的思考和研究...

---

##  61×67 的优化

按照文档中的提示，我们先尝试了61*67

做完32x32一个自然的想法是能否套用之前32x32的方法，于是我们将矩阵分为四个区域：

```
        j=0..55    j=56..60
i=0..63  [主体8×8]  [右边界]
i=64..66 [底部边界] [右下角]
```

- **主体**（i=0..63, j=0..55）：64×56，可以用 8×8 分块优化（直接套用32*32的方法）
- **右边界**（i=0..66, j=56..60）：共 5 列，直接转置
- **底部边界**（i=64..66, j=0..55）：共 3 行，直接转置

这种方式会有2095次（将右下角重复计算）miss（将右下角分给底部边界会到2087,分给右边界回到2077,这都是因为局部性），其实已经拿到了分数的绝大部分，我们继续优化：

### 右边界的优化

由于两个边界的分块都是直接转置，会导致大量不可避免的miss，于是我们希望将右边界通过局部变量的方式进行暂存从而减少miss

右边界只有 5 列，直接展开：

```c
for(int i = 0; i < 67; i++) {
    int t0=A[i][56], t1=A[i][57], t2=A[i][58], t3=A[i][59], t4=A[i][60];
    B[56][i]=t0; B[57][i]=t1; B[58][i]=t2; B[59][i]=t3; B[60][i]=t4;
}
```
这时来到了2064

### 8X8-->8x4

我们发现再主体8*8分块时，由于A，B重复交替的evcit，会导致大量miss，于是我们希望将上下分开处理，实际上由于矩阵规模变大，cache能够存放的行数在变小，这样还可以有效解决这一问题

把主体 8×8 分块的循环拆成两个 4 列的循环，miss 数从 2058 降到 2023：

```c
// 先处理前4列
for (int u = i; u < i + 8; u++) {
              int tmp0 = A[u][j];
              int tmp1 = A[u][j+1];
              int tmp2 = A[u][j+2];
              int tmp3 = A[u][j+3];

              B[j][u]   = tmp0;
              B[j+1][u] = tmp1;
              B[j+2][u] = tmp2;
              B[j+3][u] = tmp3;
}
//再处理后4列
            for (int u = i; u < i + 8; u++) {
              int tmp4 = A[u][j+4];
              int tmp5 = A[u][j+5];
              int tmp6 = A[u][j+6];
              int tmp7 = A[u][j+7];

              B[j+4][u] = tmp4;
              B[j+5][u] = tmp5;
              B[j+6][u] = tmp6;
              B[j+7][u] = tmp7;
```

事实上，此时已经达到只有0.2分没有拿到，笔者已经想不到任何的办法了:( ~~其实是尝试以为可以减少miss的方式，但效果都相反~~

完整代码：
```c
for(int i = 0; i < 64; i +=8){
        for(int j = 0; j < 56; j +=8){
            for (int u = i; u < i + 8; u++) {
              int tmp0 = A[u][j];
              int tmp1 = A[u][j+1];
              int tmp2 = A[u][j+2];
              int tmp3 = A[u][j+3];

              B[j][u]   = tmp0;
              B[j+1][u] = tmp1;
              B[j+2][u] = tmp2;
              B[j+3][u] = tmp3;
}

            for (int u = i; u < i + 8; u++) {
              int tmp4 = A[u][j+4];
              int tmp5 = A[u][j+5];
              int tmp6 = A[u][j+6];
              int tmp7 = A[u][j+7];

              B[j+4][u] = tmp4;
              B[j+5][u] = tmp5;
              B[j+6][u] = tmp6;
              B[j+7][u] = tmp7;
}
              
            }
          }
          
          for(int i = 64; i < 67; i +=1)
            for(int j = 0; j < 56; j +=1){
            B[j][i]=A[i][j];
          }
           for(int i = 0; i < 67; i++) {
          int tmp0=A[i][56];
          int tmp1=A[i][57];
          int tmp2=A[i][58];
          int tmp3=A[i][59];
          int tmp4=A[i][60];
          B[56][i]=tmp0; 
          B[57][i]=tmp1; 
          B[58][i]=tmp2; 
          B[59][i]=tmp3; 
          B[60][i]=tmp4;
      }

}
```


---

## 64×64

按照文档64×64 是三个测试用例中最难的，但实际上由于这是一个方阵，规律还是比较好找的，比起61*67的漫长尝试还没有达到2000miss，64x64并没有花费太多时间就满足了要求

我们还是尝试在上一问中的8*4策略，大约1900次miss，已经可以拿到一半的分数，说明这样的策略是有效的

我们仔细分析一下这道题目的miss来源：

会发现Cache 只有 32 个 cache line，64×64 矩阵每 4 行就会把 cache 占满（64×4×4 = 1024B = cache 大小）。这意味着 A 矩阵的第 0 行和第 4 行、第 8 行...会映射到同一个 set，产生大量冲突。

受到上一问的启发，一个自然的想法是将矩阵分为4x4的小块，经过测试，发现效果变差，事实上4×4 虽然可能解决了上面这一问题，却让 A 矩阵每一行都被重复加载了 2 次，这大大增加了miss，那么如何平衡这一问题呢：

由于我们有局部变量这一手段，我们也容易想到能不能将第一次加载的A矩阵存下来，不用进行第二次加载，但是由于我们只有
12个临时变量可以用，于是我们可能需要利用B矩阵先帮助我们存放一些数据

我们可以把 8×8 的区域想象成四个 4×4 的小方块：

    A 的四个块：​左上、​右上、左下、右下

    B 的四个块：​左上、​右上、左下、右下

一次性读 A 的一整行 (8个数)，将A的左上转置存入 B 的左上，将 A 的右上 转置存入 B 的右上 (暂时寄放)，趁 A 的一行在 Cache 里，把8个数全拿走。此时B的左上已经完成了转置，右上则是直接复制过来的

然后读取 A 的左下角的一列，读取刚才寄存在 B 右上角的一行，把 A 的左下角填到 B 的右上角，再把把刚才取出的B右上角暂存的填到 B 的左下角

最后将 A 的右下角 4x4直接放到B的右下角即可

最后miss来到了1180次，满分通过！

完整代码：

```c

  else if (M == 64 && N == 64) {
    // you can do 64x64 transpose here
         for(int i = 0; i < 64; i +=8){
        for(int j = 0; j < 64; j +=8){
            for (int u = i; u < i + 4; u++) {
              int tmp0 = A[u][j];
              int tmp1 = A[u][j+1];
              int tmp2 = A[u][j+2];
              int tmp3 = A[u][j+3];
              int tmp4 = A[u][j+4];
              int tmp5 = A[u][j+5];
              int tmp6 = A[u][j+6];
              int tmp7 = A[u][j+7];


              B[j][u]   = tmp0;
              B[j+1][u] = tmp1;
              B[j+2][u] = tmp2;
              B[j+3][u] = tmp3;
              B[j][u+4]   = tmp4;
              B[j+1][u+4] = tmp5;
              B[j+2][u+4] = tmp6;
              B[j+3][u+4] = tmp7;
}

            for (int u = j; u < j + 4; u++) {
              int tmp0 = A[i+4][u];
              int tmp1 = A[i+5][u];
              int tmp2 = A[i+6][u];
              int tmp3 = A[i+7][u];
              int tmp4 = B[u][i+4];
              int tmp5 = B[u][i+5];
              int tmp6 = B[u][i+6];
              int tmp7 = B[u][i+7];

              B[u][i+4]   = tmp0;
              B[u][i+5] = tmp1;
              B[u][i+6] = tmp2;
              B[u][i+7] = tmp3;
              B[u+4][i] = tmp4;
              B[u+4][i+1] = tmp5;
              B[u+4][i+2] = tmp6;
              B[u+4][i+3] = tmp7;
}
            for(int u = i + 4; u < i + 8; u++) {
              int tmp0 = A[u][j+4];
              int tmp1 = A[u][j+5];
              int tmp2 = A[u][j+6];
              int tmp3 = A[u][j+7];

              B[j+4][u] = tmp0;
              B[j+5][u] = tmp1;
              B[j+6][u] = tmp2;
              B[j+7][u] = tmp3;
            }
            
            }
          }
  }
```

---
