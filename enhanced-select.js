// ===== 增强的自定义下拉框填充函数 =====
// 采用多阶段策略：展开 → 等待 → 查找 → 回退

async function tryFillCustomSelectEnhanced(el, targetValue, fieldId = null) {
  const target = String(targetValue).trim();
  if (!target) {
    console.log(`[快填] #${fieldId} 目标值为空，跳过`);
    return false;
  }
  
  console.log(`[快填] #${fieldId} 开始填充下拉框，目标值: "${target}"`);
  
  try {
    // ===== 阶段1：展开策略 =====
    console.log(`[快填] #${fieldId} 阶段1: 尝试展开下拉框...`);
    const expanded = await expandDropdown(el, fieldId);
    if (!expanded) {
      console.log(`[快填] #${fieldId} 展开失败，尝试回退策略`);
      return await fallbackFillStrategy(el, target, fieldId);
    }
    
    // ===== 阶段2：等待选项出现 =====
    console.log(`[快填] #${fieldId} 阶段2: 等待选项出现...`);
    const optionsContainer = await waitForOptions(el, fieldId, 3000);
    if (!optionsContainer) {
      console.log(`[快填] #${fieldId} 选项未出现，尝试回退策略`);
      closeDropdown(el);
      return await fallbackFillStrategy(el, target, fieldId);
    }
    
    // ===== 阶段3：查找和匹配选项 =====
    console.log(`[快填] #${fieldId} 阶段3: 查找匹配的选项...`);
    const matched = await findAndClickOption(optionsContainer, target, el, fieldId);
    if (matched) {
      console.log(`[快填] #${fieldId} 成功选择选项`);
      await sleep(200);
      closeDropdown(el);
      return true;
    }
    
    // ===== 阶段4：尝试输入搜索 =====
    console.log(`[快填] #${fieldId} 阶段4: 尝试输入搜索...`);
    const searchSuccess = await trySearchableDropdown(el, target, fieldId);
    if (searchSuccess) {
      console.log(`[快填] #${fieldId} 通过搜索成功选择`);
      await sleep(200);
      closeDropdown(el);
      return true;
    }
    
    console.log(`[快填] #${fieldId} 所有策略都失败`);
    closeDropdown(el);
    return false;
    
  } catch(e) {
    console.error(`[快填] #${fieldId} 异常:`, e.message);
    closeDropdown(el);
    return false;
  }
}

// ===== 展开策略 =====
async function expandDropdown(el, fieldId) {
  const strategies = [
    async () => {
      console.log(`[快填] #${fieldId} 尝试 .click()`);
      el.click();
      await sleep(300);
      return true;
    },
    async () => {
      console.log(`[快填] #${fieldId} 尝试 mousedown+mouseup`);
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await sleep(100);
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await sleep(300);
      return true;
    },
    async () => {
      console.log(`[快填] #${fieldId} 尝试 focus+ArrowDown`);
      el.focus();
      await sleep(100);
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await sleep(300);
      return true;
    },
    async () => {
      console.log(`[快填] #${fieldId} 尝试 focus+Enter`);
      el.focus();
      await sleep(100);
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await sleep(300);
      return true;
    }
  ];
  
  for (const strategy of strategies) {
    try {
      await strategy();
      // 检查是否有选项出现
      const opts = getVisibleOptions();
      if (opts.length > 0) {
        console.log(`[快填] #${fieldId} 展开成功，找到 ${opts.length} 个选项`);
        return true;
      }
    } catch(e) {
      console.warn(`[快填] #${fieldId} 展开策略异常:`, e.message);
    }
  }
  
  return false;
}

// ===== 等待选项出现 =====
async function waitForOptions(el, fieldId, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    // 立即检查
    const opts = getVisibleOptions();
    if (opts.length > 0) {
      console.log(`[快填] #${fieldId} 立即找到选项`);
      resolve(document.body);
      return;
    }
    
    // 使用 MutationObserver 监听 DOM 变化
    const observer = new MutationObserver(() => {
      const opts = getVisibleOptions();
      if (opts.length > 0) {
        console.log(`[快填] #${fieldId} 通过 MutationObserver 检测到选项`);
        observer.disconnect();
        resolve(document.body);
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });
    
    // 超时处理
    const timeoutId = setTimeout(() => {
      observer.disconnect();
      console.log(`[快填] #${fieldId} 等待选项超时 (${timeoutMs}ms)`);
      resolve(null);
    }, timeoutMs);
  });
}

// ===== 获取可见选项 =====
function getVisibleOptions() {
  const selectors = [
    '[role="option"]',
    '.el-select-dropdown__item',
    '.ant-select-item-option',
    '.ivu-select-item',
    '.n-base-select-option',
    'li[class*="option"]',
    'div[class*="item"][class*="select"]',
    'li[class*="item"]',
    'div[class*="dropdown"] li',
    'div[class*="dropdown"] div[class*="item"]'
  ];
  
  for (const selector of selectors) {
    const opts = Array.from(document.querySelectorAll(selector))
      .filter(o => o.offsetParent !== null && o.textContent.trim().length > 0);
    if (opts.length > 0) {
      return opts;
    }
  }
  
  return [];
}

// ===== 查找和点击选项 =====
async function findAndClickOption(container, target, el, fieldId) {
  const options = getVisibleOptions();
  console.log(`[快填] #${fieldId} 找到 ${options.length} 个选项，查找: "${target}"`);
  
  // 规范化目标文本
  const normalizedTarget = normalizeText(target);
  
  // 第一轮：精确匹配
  for (const opt of options) {
    const text = opt.textContent.trim();
    const normalized = normalizeText(text);
    if (normalized === normalizedTarget) {
      console.log(`[快填] #${fieldId} 精确匹配: "${text}"`);
      opt.click();
      return true;
    }
  }
  
  // 第二轮：包含匹配
  for (const opt of options) {
    const text = opt.textContent.trim();
    const normalized = normalizeText(text);
    if (normalized.includes(normalizedTarget) || normalizedTarget.includes(normalized)) {
      console.log(`[快填] #${fieldId} 包含匹配: "${text}"`);
      opt.click();
      return true;
    }
  }
  
  // 第三轮：编辑距离匹配（相似度 > 0.7）
  for (const opt of options) {
    const text = opt.textContent.trim();
    const normalized = normalizeText(text);
    const similarity = calculateSimilarity(normalizedTarget, normalized);
    if (similarity > 0.7) {
      console.log(`[快填] #${fieldId} 相似度匹配 (${(similarity*100).toFixed(0)}%): "${text}"`);
      opt.click();
      return true;
    }
  }
  
  console.log(`[快填] #${fieldId} 未找到匹配的选项`);
  return false;
}

// ===== 尝试可搜索下拉框 =====
async function trySearchableDropdown(el, target, fieldId) {
  console.log(`[快填] #${fieldId} 尝试可搜索下拉框...`);
  
  // 查找输入框
  const input = el.tagName === 'INPUT' ? el : el.querySelector('input');
  if (!input) {
    console.log(`[快填] #${fieldId} 未找到输入框`);
    return false;
  }
  
  try {
    // 清空并输入
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);
    
    input.value = target;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: target[0], bubbles: true }));
    await sleep(500);
    
    // 查找匹配的选项
    const options = getVisibleOptions();
    console.log(`[快填] #${fieldId} 输入后找到 ${options.length} 个选项`);
    
    for (const opt of options) {
      const text = opt.textContent.trim();
      if (normalizeText(text).includes(normalizeText(target))) {
        console.log(`[快填] #${fieldId} 搜索匹配: "${text}"`);
        opt.click();
        return true;
      }
    }
  } catch(e) {
    console.warn(`[快填] #${fieldId} 搜索失败:`, e.message);
  }
  
  return false;
}

// ===== 回退策略 =====
async function fallbackFillStrategy(el, target, fieldId) {
  console.log(`[快填] #${fieldId} 尝试回退策略...`);
  
  // 策略1：直接设置隐藏输入的值
  const hiddenInput = el.querySelector('input[type="hidden"]');
  if (hiddenInput) {
    console.log(`[快填] #${fieldId} 尝试设置隐藏输入值`);
    hiddenInput.value = target;
    hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);
    return true;
  }
  
  // 策略2：直接设置元素的 value
  try {
    if (el.tagName === 'INPUT') {
      el.value = target;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(100);
      return true;
    }
  } catch(e) {
    console.warn(`[快填] #${fieldId} 回退策略失败:`, e.message);
  }
  
  return false;
}

// ===== 关闭下拉框 =====
function closeDropdown(el) {
  try {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    el.blur && el.blur();
  } catch(e) {}
}

// ===== 文本规范化 =====
function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\u3000]/g, ' ')
    .trim();
}

// ===== 编辑距离相似度 =====
function calculateSimilarity(a, b) {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = getEditDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function getEditDistance(s1, s2) {
  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}
