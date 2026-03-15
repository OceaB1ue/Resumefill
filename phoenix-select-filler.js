// phoenix-select 智能填写模块 - 最终版：增强匹配策略，确保触发框架事件
// 使用模块作用域避免污染全局

(function() {
  'use strict';
  
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  
  const normalizeText = (str) => (str || '').toLowerCase().replace(/\s+/g, '').trim();
  
  const PHOENIX_SELECT_MAP = {
    '出生日期': (resume) => resume.birth_date || '',
    '现居住地': (resume) => resume.location || '',
    '政治面貌': (resume) => resume.political_status || '中共党员',
    '民族': (resume) => resume.ethnicity || '汉族',
    '籍贯（只选到省级单位即可）': (resume) => resume.hometown || '',
    '户口所在地': (resume) => resume.hukou || '',
    // 开始时间/结束时间 由动态逻辑处理，根据区块选择对应经历
    '学习形式': (resume) => resume.education?.[0]?.study_type || '全日制',
    '学历': (resume) => resume.education?.[0]?.degree || '本科',
    '学位': (resume) => resume.education?.[0]?.degree || '学士',
    '班级排名': (resume) => resume.education?.[0]?.ranking || '',
    '城市': (resume) => resume.target_city || resume.location || '',
    '是否紧急联系人（填写2条家庭成员以上信息时只选1人为紧急联系人）': (resume) => '是',
    '期望从事职业': (resume) => resume.target_position || '',
    '期望工作城市': (resume) => resume.target_city || '',
    '获奖级别': (resume) => resume.awards?.[0]?.level || '国家级',
    '获奖时间': (resume) => resume.awards?.[0]?.date || '',
    '发布时间': (resume) => resume.publications?.[0]?.date || '',
    '证书种类': (resume) => resume.certificates?.[0]?.type || '',
    '获得时间': (resume) => resume.certificates?.[0]?.date || '',
    '语言类型': (resume) => resume.languages?.[0]?.language || '英语',
    '掌握程度': (resume) => resume.languages?.[0]?.level || '精通',
    '听说': (resume) => resume.languages?.[0]?.speaking || '精通',
    '读写': (resume) => resume.languages?.[0]?.reading || '精通',
  };

  // 等待元素出现
  const waitForElement = (selectors, timeout = 5000) => {
    return new Promise((resolve) => {
      const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
      const check = () => {
        for (const sel of selectorArray) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) return el;
        }
        return null;
      };
      
      const found = check();
      if (found) { resolve(found); return; }
      
      const observer = new MutationObserver(() => {
        const el = check();
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });
      
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
      
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  };

  // 增强的选项选择器 - 覆盖北森系统
  const getVisibleOptions = () => {
    const selectors = [
      '[role="option"]',
      'li[class*="option"]', 'li[class*="item"]',
      'div[class*="option"]', 'div[class*="item"]',
      '.beisen-select-option',
      '.phoenix-select__option',
      '.phoenix-select-dropdown li',
      '.phoenix-select-menu li',
      '[class*="dropdown"] li',
      '[class*="select"] li',
      '[class*="menu"] li',
      'ul li[class*="item"]',
      'span[class*="option"]'
    ];
    
    const allOpts = [];
    for (const sel of selectors) {
      const opts = Array.from(document.querySelectorAll(sel))
        .filter(o => o.offsetParent !== null && o.textContent.trim().length > 0);
      allOpts.push(...opts);
    }
    
    // 去重
    const uniqueOpts = [...new Set(allOpts)];
    if (uniqueOpts.length > 0) {
      console.log(`[快填] 找到 ${uniqueOpts.length} 个可见选项`);
      // 打印前10个选项用于调试
      uniqueOpts.slice(0, 10).forEach((opt, i) => {
        console.log(`[快填] 选项${i+1}: "${opt.textContent.trim()}"`);
      });
    }
    
    return uniqueOpts;
  };

  // 等待选项出现
  const waitForOptions = (timeout = 3000) => {
    return new Promise(resolve => {
      const opts = getVisibleOptions();
      if (opts.length) return resolve(opts);
      
      const observer = new MutationObserver(() => {
        const o = getVisibleOptions();
        if (o.length) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(o);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
      
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(getVisibleOptions());
      }, timeout);
    });
  };

  // 等待选项更新（监听DOM变化）
  const waitForOptionsUpdated = (timeout = 2000) => {
    return new Promise(resolve => {
      const initialOptions = getVisibleOptions();
      const initialCount = initialOptions.length;
      
      console.log(`[快填] 初始选项数量: ${initialCount}`);

      const observer = new MutationObserver(() => {
        const currentOptions = getVisibleOptions();
        if (currentOptions.length !== initialCount) {
          console.log(`[快填] 选项数量变化: ${initialCount} -> ${currentOptions.length}`);
          observer.disconnect();
          clearTimeout(timer);
          resolve(currentOptions);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });

      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(getVisibleOptions());
      }, timeout);
    });
  };

  // 多阶段展开下拉框
  const expandDropdown = async (el) => {
    console.log(`[快填] 尝试展开下拉框`);
    
    const strategies = [
      { name: 'click', fn: () => el.click() },
      { name: 'mousedown', fn: () => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) },
      { name: 'click-event', fn: () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })) },
      { name: 'arrow-down', fn: () => { el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); } },
      { name: 'enter', fn: () => { el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); } },
      { name: 'space', fn: () => { el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); } }
    ];
    
    for (const strategy of strategies) {
      try { 
        console.log(`[快填] 尝试策略: ${strategy.name}`);
        strategy.fn(); 
      } catch (e) { 
        console.warn(`[快填] 策略 ${strategy.name} 失败:`, e.message); 
      }
      await sleep(400);
      const opts = getVisibleOptions();
      if (opts.length > 0) {
        console.log(`[快填] 展开成功，策略: ${strategy.name}`);
        return true;
      }
    }
    return false;
  };

  // 关闭下拉框
  const closeDropdown = (el) => {
    try {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      el.blur();
      document.body.click();
    } catch (e) {}
  };

  // 点击确认按钮
  const clickConfirmButton = async () => {
    const confirmBtn = Array.from(document.querySelectorAll('button, [class*="btn"], [class*="confirm"], [class*="ok"]'))
      .find(btn => {
        const text = btn.textContent.trim();
        return text === '确定' || text === '确认' || text === 'OK' || text === '保存';
      });
    if (confirmBtn && confirmBtn.offsetParent !== null) {
      console.log(`[快填] 点击确认按钮: "${confirmBtn.textContent.trim()}"`);
      confirmBtn.click();
      await sleep(300);
      return true;
    }
    return false;
  };

  // 增强的选项匹配（包含、分词、相似度）
  const findOptionByText = (options, target) => {
    const normalizedTarget = normalizeText(target);
    const targetWords = normalizedTarget.split(/\s+/).filter(w => w.length > 1);
    
    console.log(`[快填] 查找选项，目标: "${target}" (normalized: "${normalizedTarget}")`);
    console.log(`[快填] 分词: ${JSON.stringify(targetWords)}`);
    
    // 1. 精确匹配
    for (const opt of options) {
      const text = opt.textContent.trim();
      const normalized = normalizeText(text);
      if (normalized === normalizedTarget) {
        console.log(`[快填] 精确匹配: "${text}"`);
        return opt;
      }
    }
    
    // 2. 包含匹配（选项包含目标）
    for (const opt of options) {
      const text = opt.textContent.trim();
      const normalized = normalizeText(text);
      if (normalized.includes(normalizedTarget)) {
        console.log(`[快填] 包含匹配(选项含目标): "${text}"`);
        return opt;
      }
    }
    
    // 3. 包含匹配（目标包含选项）
    for (const opt of options) {
      const text = opt.textContent.trim();
      const normalized = normalizeText(text);
      if (normalizedTarget.includes(normalized) && normalized.length > 0) {
        console.log(`[快填] 包含匹配(目标含选项): "${text}"`);
        return opt;
      }
    }
    
    // 4. 分词匹配：检查所有目标词是否都出现在选项文本中
    if (targetWords.length > 0) {
      for (const opt of options) {
        const text = opt.textContent.trim();
        const normalized = normalizeText(text);
        const allWordsPresent = targetWords.every(word => normalized.includes(word));
        if (allWordsPresent) {
          console.log(`[快填] 分词匹配: "${text}"`);
          return opt;
        }
      }
    }
    
    // 5. 宽松匹配：任意一个目标词出现在选项中
    if (targetWords.length > 0) {
      for (const opt of options) {
        const text = opt.textContent.trim();
        const normalized = normalizeText(text);
        const anyWordPresent = targetWords.some(word => normalized.includes(word));
        if (anyWordPresent) {
          console.log(`[快填] 宽松匹配: "${text}"`);
          return opt;
        }
      }
    }
    
    console.log(`[快填] 未找到匹配选项`);
    return null;
  };

  // 回退填充
  const fallbackFill = async (el, value) => {
    const input = el.tagName === 'INPUT' ? el : el.querySelector('input');
    if (input) {
      console.log(`[快填] 回退填充: "${value}"`);
      
      // 使用原生 setter
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(input, value);
      
      // 触发所有事件
      input.dispatchEvent(new Event('focus', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
      
      await sleep(300);
      return true;
    }
    return false;
  };

  // 检测字段类型
  const detectFieldType = (label) => {
    const lower = label.toLowerCase();
    if (lower.includes('时间') || lower.includes('日期') || lower.includes('年') || lower.includes('月')) return 'date';
    if (lower.includes('地') || lower.includes('城市') || lower.includes('省') || lower.includes('市')) return 'location';
    if (lower.includes('民族')) return 'ethnicity';
    return 'normal';
  };

  // 解析日期
  const parseDateValue = (dateStr) => {
    if (!dateStr) return null;
    const yearMatch = dateStr.match(/(\d{4})/);
    const monthMatch = dateStr.match(/[年\-\.\/](\d{1,2})[月\-\.\/]?/);
    const dayMatch = dateStr.match(/[日\-\.\/](\d{1,2})$/);
    
    const year = yearMatch ? parseInt(yearMatch[1]) : null;
    const month = monthMatch ? parseInt(monthMatch[1]) : null;
    let day = dayMatch ? parseInt(dayMatch[1]) : null;
    
    if (!day && month) day = 1;
    
    console.log(`[快填] parseDate("${dateStr}") => year=${year}, month=${month}, day=${day}`);
    return { year, month, day };
  };

  // 日期选择器填充 - 终极版，确保年份选择
  const fillDatePickerByClick = async (el, value) => {
    console.log(`[快填] ========== 日期选择器终极版 ==========`);
    console.log(`[快填] 输入值: "${value}"`);
    
    const parsed = parseDateValue(value);
    if (!parsed || !parsed.year || !parsed.month) {
      console.warn(`[快填] 日期解析失败: ${value}`);
      return false;
    }
    
    const { year, month, day } = parsed;
    console.log(`[快填] 目标日期: 年=${year}, 月=${month}, 日=${day || 1}`);
    
    // 1. 点击展开日期选择器
    const trigger = el.querySelector('.phoenix-select__switchArrow') || 
                   el.querySelector('.phoenix-select__placeHolder') || 
                   el.querySelector('input') || 
                   el;
    trigger.click();
    await sleep(800);
    
    // 2. 等待日期面板出现（使用更通用的选择器）
    const panelSelectors = [
      '.phoenix-date-picker-panel', 
      '.phoenix-calendar',
      '[class*="date-picker-dropdown"]',
      '[class*="picker-panel"]',
      '.el-picker-panel',
      '.ant-picker-dropdown'
    ];
    let panel = await waitForElement(panelSelectors, 5000);
    if (!panel) {
      console.log(`[快填] 日期面板未出现，尝试直接设置输入`);
      return await fallbackFill(el, value);
    }
    console.log(`[快填] 日期面板已出现`);
    console.log(`[快填] 日期面板 HTML (前500字符):`, panel.outerHTML.slice(0, 500));
    console.log(`[快填] 日期面板所有可点击元素:`, Array.from(panel.querySelectorAll('span, button, div, a')).slice(0, 20).map(e => `"${e.textContent.trim()}" (${e.tagName})`));
    
    // 3. 查找年份显示/选择区域
    const yearBtnSelectors = [
      '.phoenix-date-picker__header-year',
      '.phoenix-date-picker__year-btn',
      'button[class*="year"]',
      'span[class*="year"]',
      '.el-date-picker__header-label',
      '.ant-picker-year-btn',
      '[class*="header"] span',
      '[class*="header"] button',
      '.phoenix-date-picker-panel span',
      '.phoenix-date-picker-panel button'
    ];
    
    let yearBtn = null;
    
    // 方法1：通过选择器查找
    for (const sel of yearBtnSelectors) {
      const btns = panel.querySelectorAll(sel);
      for (const btn of btns) {
        const text = btn.textContent.trim();
        // 查找包含4位数字的元素（年份），支持 "2026"、"2026年"、"2026 年" 等格式
        if (text && text.match(/\d{4}/) && text.length <= 10) {
          yearBtn = btn;
          console.log(`[快填] 通过选择器找到年份按钮: "${text}" (选择器: ${sel})`);
          break;
        }
      }
      if (yearBtn) break;
    }
    
    // 方法2：如果选择器没找到，遍历所有可点击元素查找年份
    if (!yearBtn) {
      console.log(`[快填] 选择器未找到年份按钮，尝试遍历查找`);
      const allClickable = panel.querySelectorAll('span, button, div, a');
      for (const elem of allClickable) {
        const text = elem.textContent.trim();
        // 查找包含年份的文本，支持多种格式
        if (text && text.match(/\d{4}/) && text.length <= 10) {
          yearBtn = elem;
          console.log(`[快填] 遍历找到年份按钮: "${text}"`);
          break;
        }
      }
    }
    
    // 方法3：查找包含年份范围或当前年份的元素
    if (!yearBtn) {
      console.log(`[快填] 尝试查找包含年份的元素`);
      const allElements = panel.querySelectorAll('*');
      const currentYear = new Date().getFullYear();
      for (const elem of allElements) {
        const text = elem.textContent.trim();
        // 查找包含当前年份的元素
        if (text && text.includes(currentYear.toString()) && text.length < 30) {
          // 检查是否可点击
          if (elem.tagName === 'SPAN' || elem.tagName === 'BUTTON' || 
              elem.tagName === 'DIV' || elem.tagName === 'A') {
            yearBtn = elem;
            console.log(`[快填] 找到包含当前年份的元素: "${text}"`);
            break;
          }
        }
      }
    }
    
    if (yearBtn) {
      // 点击年份按钮进入年份选择模式
      yearBtn.click();
      await sleep(600);
      
      // 等待年份列表出现
      const yearPanelSelectors = [
        '.phoenix-date-picker__year-panel',
        '[class*="year-panel"]',
        '.el-year-table',
        '.ant-picker-year-panel'
      ];
      const yearPanel = await waitForElement(yearPanelSelectors, 3000);
      
      if (yearPanel) {
        console.log(`[快填] 年份面板已出现`);
        // 查找目标年份
        const yearOptions = yearPanel.querySelectorAll('td, [class*="cell"], [class*="year-item"], li');
        let yearFound = false;
        for (const opt of yearOptions) {
          const text = opt.textContent.trim();
          if (text === year.toString() || text.includes(year.toString())) {
            console.log(`[快填] 选择年份: ${text}`);
            opt.click();
            yearFound = true;
            await sleep(400);
            break;
          }
        }
        if (!yearFound) {
          console.log(`[快填] 未找到年份 ${year}，尝试通过翻页查找`);
          // 尝试查找翻页按钮
          const nextBtn = panel.querySelector('[class*="next"], [class*="arrow-right"]');
          if (nextBtn) {
            console.log(`[快填] 尝试点击下一页`);
            nextBtn.click();
            await sleep(400);
            // 再次查找年份
            const yearOptions2 = yearPanel.querySelectorAll('td, [class*="cell"], [class*="year-item"], li');
            for (const opt of yearOptions2) {
              const text = opt.textContent.trim();
              if (text === year.toString() || text.includes(year.toString())) {
                console.log(`[快填] 翻页后选择年份: ${text}`);
                opt.click();
                await sleep(400);
                break;
              }
            }
          }
        }
      } else {
        console.log(`[快填] 年份面板未出现，可能年份已直接可点`);
        // 可能年份已经直接显示在列表中，尝试直接点击年份
        const yearOptions = panel.querySelectorAll('td, [class*="cell"], [class*="year-item"], li');
        for (const opt of yearOptions) {
          const text = opt.textContent.trim();
          if (text === year.toString() || text.includes(year.toString())) {
            console.log(`[快填] 直接选择年份: ${text}`);
            opt.click();
            await sleep(400);
            break;
          }
        }
      }
    } else {
      console.log(`[快填] 未找到年份按钮，尝试直接选择月份`);
    }
    
    // 4. 选择月份
    await sleep(400);
    const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    const targetMonth = monthNames[month - 1];
    
    // 重新获取当前活动的面板
    panel = document.querySelector(panelSelectors.join(','));
    if (panel && panel.offsetParent !== null) {
      const monthOptions = panel.querySelectorAll('td, [class*="month-item"], [class*="cell"], li');
      let monthFound = false;
      for (const opt of monthOptions) {
        const text = opt.textContent.trim();
        if (text === targetMonth || text === month.toString() || text === String(month).padStart(2, '0')) {
          console.log(`[快填] 选择月份: ${text}`);
          opt.click();
          monthFound = true;
          await sleep(400);
          break;
        }
      }
      if (!monthFound) {
        console.log(`[快填] 未找到月份 ${month}`);
      }
    }
    
    // 5. 选择日期（如果有）
    if (day) {
      await sleep(300);
      panel = document.querySelector(panelSelectors.join(','));
      if (panel && panel.offsetParent !== null) {
        const dayOptions = panel.querySelectorAll('td.available, td[class*="cell"], [class*="day-item"], td');
        for (const opt of dayOptions) {
          const text = opt.textContent.trim();
          if (text === day.toString() && /^\d{1,2}$/.test(text)) {
            console.log(`[快填] 选择日期: ${text}`);
            opt.click();
            await sleep(400);
            break;
          }
        }
      }
    }
    
    // 6. 点击确认按钮（如果存在）
    await clickConfirmButton();
    
    // 7. 关闭面板
    document.body.click();
    await sleep(200);
    
    console.log(`[快填] ========== 日期选择器填写完成 ==========`);
    return true;
  };

  // 地址选择器填充 - 增强版，增加等待和确认
  const fillLocationPickerByClick = async (el, value) => {
    console.log(`[快填] ========== 地址选择器增强版 ==========`);
    console.log(`[快填] 输入值: "${value}"`);
    
    if (!value) return false;
    
    // 解析地址
    let province = '';
    let city = '';
    let district = '';
    
    const addrStr = value.trim();
    
    if (addrStr.includes('省') && addrStr.includes('市')) {
      const provinceEnd = addrStr.indexOf('省');
      if (provinceEnd > 0) {
        province = addrStr.substring(0, provinceEnd);
        const cityPart = addrStr.substring(provinceEnd + 1);
        const cityEnd = cityPart.indexOf('市');
        if (cityEnd > 0) {
          city = cityPart.substring(0, cityEnd);
          district = cityPart.substring(cityEnd + 1).replace(/[区县]$/, '');
        }
      }
    } else if (addrStr.includes('市') && !addrStr.includes('省')) {
      const cityEnd = addrStr.indexOf('市');
      province = addrStr.substring(0, cityEnd);
      city = province;
    } else {
      const parts = addrStr.split(/[省市区]/);
      province = parts[0] || '';
      city = parts[1] || '';
      district = parts[2] || '';
    }
    
    province = province.trim();
    city = city.trim();
    district = district.trim();
    
    if (city.includes('省')) {
      city = city.replace('省', '').trim();
    }
    
    console.log(`[快填] 地址解析: province="${province}", city="${city}", district="${district}"`);
    
    if (!province) {
      console.warn(`[快填] 无法解析省份`);
      return false;
    }
    
    // 1. 点击展开
    const trigger = el.querySelector('.phoenix-select__switchArrow') || 
                   el.querySelector('.phoenix-select__placeHolder') || 
                   el.querySelector('input') || 
                   el;
    trigger.click();
    await sleep(600);
    
    // 2. 等待面板出现
    const panelSelectors = [
      '.phoenix-select-dropdown',
      '.phoenix-select-menu',
      '[class*="select-dropdown"]',
      '[class*="cascader-dropdown"]'
    ];
    const panel = await waitForElement(panelSelectors, 3000);
    if (!panel) {
      console.log(`[快填] 地址面板未出现`);
      return false;
    }
    console.log(`[快填] 地址面板已出现`);
    
    // 辅助函数：等待选项出现并点击
    const findAndClick = async (targetText, timeout = 3000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const options = getVisibleOptions();
        for (const opt of options) {
          const text = opt.textContent.trim();
          if (text === targetText || text === (targetText + '省') || text === (targetText + '市') ||
              text.includes(targetText) || targetText.includes(text)) {
            if (text.length < 20) {
              console.log(`[快填] 点击选项: "${text}"`);
              opt.click();
              return true;
            }
          }
        }
        await sleep(200);
      }
      return false;
    };
    
    // 3. 选择省份
    if (province) {
      console.log(`[快填] 开始选择省份: ${province}`);
      const ok = await findAndClick(province, 3000);
      if (ok) {
        console.log(`[快填] 已选择省份: ${province}`);
        await sleep(800); // 等待城市加载
      } else {
        console.log(`[快填] 未找到省份: ${province}`);
      }
    }
    
    // 4. 选择城市
    if (city) {
      console.log(`[快填] 开始选择城市: ${city}`);
      const ok = await findAndClick(city, 3000);
      if (ok) {
        console.log(`[快填] 已选择城市: ${city}`);
        await sleep(800);
      } else {
        console.log(`[快填] 未找到城市: ${city}`);
      }
    }
    
    // 5. 选择区县
    if (district) {
      console.log(`[快填] 开始选择区县: ${district}`);
      const ok = await findAndClick(district, 3000);
      if (ok) {
        console.log(`[快填] 已选择区县: ${district}`);
        await sleep(800);
      } else {
        console.log(`[快填] 未找到区县: ${district}`);
      }
    }
    
    // 6. 点击确认
    await clickConfirmButton();
    
    // 7. 关闭面板
    document.body.click();
    await sleep(200);
    
    console.log(`[快填] ========== 地址选择器填写完成 ==========`);
    return true;
  };

  // 增强版通用下拉框填充
  const fillGenericSelect = async (el, targetValue) => {
    const target = String(targetValue).trim();
    if (!target) return false;
    
    console.log(`[快填] ========== 通用下拉框填充开始 ==========`);
    console.log(`[快填] 目标值: "${target}"`);
    
    // 1. 展开下拉框
    const expanded = await expandDropdown(el);
    if (!expanded) {
      console.log(`[快填] 展开下拉框失败，尝试直接设置输入值`);
      return await fallbackFill(el, target);
    }
    
    // 2. 等待选项出现
    let options = await waitForOptions(3000);
    if (!options.length) {
      console.log(`[快填] 无选项，尝试回退填充`);
      closeDropdown(el);
      return await fallbackFill(el, target);
    }
    
    // 3. 尝试不输入搜索直接匹配（遍历所有可见选项）
    let matched = findOptionByText(options, target);
    if (matched) {
      console.log(`[快填] 直接匹配成功: "${matched.textContent.trim()}"`);
      matched.click();
      matched.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(200);
      await clickConfirmButton();
      closeDropdown(el);
      return true;
    }
    
    // 4. 尝试输入搜索
    const input = el.tagName === 'INPUT' ? el : el.querySelector('input');
    if (input) {
      console.log(`[快填] 尝试搜索: "${target}"`);
      
      // 清空并输入
      input.focus();
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(200);
      
      nativeInputValueSetter.call(input, target);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      
      // 等待选项更新
      options = await waitForOptionsUpdated(2000);
      
      if (options.length) {
        matched = findOptionByText(options, target);
        if (matched) {
          console.log(`[快填] 搜索后匹配成功: "${matched.textContent.trim()}"`);
          matched.click();
          matched.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(200);
          await clickConfirmButton();
          closeDropdown(el);
          return true;
        }
      }
    }
    
    // 5. 最后尝试：直接点击第一个选项（如果目标值很短）
    if (target.length <= 4) {
      options = getVisibleOptions();
      if (options.length > 0) {
        const firstOpt = options[0];
        console.log(`[快填] 尝试点击第一个选项: "${firstOpt.textContent.trim()}"`);
        firstOpt.click();
        firstOpt.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(200);
        await clickConfirmButton();
        closeDropdown(el);
        return true;
      }
    }
    
    console.log(`[快填] ========== 通用下拉框填充失败 ==========`);
    closeDropdown(el);
    return false;
  };

  // Phoenix 选择器填充入口
  const fillPhoenixSelect = async (el, value, label) => {
    if (!el.classList.contains('phoenix-select')) return false;
    
    const fieldType = detectFieldType(label);
    console.log(`[快填] ==================== Phoenix 选择器 ====================`);
    console.log(`[快填] 标签: "${label}", 类型: ${fieldType}, 值: "${value}"`);
    
    // 特殊处理日期
    if (fieldType === 'date') {
      return await fillDatePickerByClick(el, value);
    }
    
    // 特殊处理地址
    if (fieldType === 'location') {
      return await fillLocationPickerByClick(el, value);
    }
    
    // 通用下拉框
    return await fillGenericSelect(el, value);
  };

  // 辅助函数：从表单项推断区块
  const getSectionFromItem = (item) => {
    // 向上查找包含区块标题的父元素
    let parent = item.parentElement;
    let level = 0;
    
    while (parent && level < 15) {
      const text = parent.textContent.toLowerCase();
      const className = (parent.className || '').toLowerCase();
      
      // 检查区块标题
      if (text.includes('教育经历') || text.includes('教育背景') || text.includes('学历信息') || 
          className.includes('education') || className.includes('edu')) {
        return 'education';
      }
      if (text.includes('项目经历') || text.includes('项目经验') || text.includes('项目信息') ||
          className.includes('project')) {
        return 'project';
      }
      if (text.includes('实习经历') || text.includes('工作经历') || text.includes('实习经验') ||
          text.includes('工作经验') || className.includes('work') || className.includes('intern')) {
        return 'work';
      }
      
      // 检查标题元素
      const headings = parent.querySelectorAll('h2, h3, h4, h5, h6, [class*="title"], [class*="header"]');
      for (const heading of headings) {
        const headingText = heading.textContent.toLowerCase();
        if (headingText.includes('教育')) return 'education';
        if (headingText.includes('项目')) return 'project';
        if (headingText.includes('实习') || headingText.includes('工作')) return 'work';
      }
      
      parent = parent.parentElement;
      level++;
    }
    
    return 'basic';
  };

  // 填充所有 Phoenix 选择器
  const fillAllPhoenixSelects = async (resume) => {
    const formItems = document.querySelectorAll('[class*="form-item"], [class*="form-group"]');
    let filled = 0;
    let failed = 0;
    
    console.log(`[快填] ========== 开始填充 Phoenix 选择器 ==========`);
    console.log(`[快填] 找到 ${formItems.length} 个表单项`);
    console.log(`[快填] 简历教育经历:`, resume.education);
    console.log(`[快填] 简历项目经历:`, resume.projects);
    console.log(`[快填] 简历实习经历:`, resume.work_experience);

    for (const item of formItems) {
      const lbl = item.querySelector('label, .label');
      if (!lbl) continue;
      
      const label = lbl.textContent.trim();
      const phoenixSelect = item.querySelector('.phoenix-select');
      if (!phoenixSelect) continue;
      
      // 推断区块
      const section = getSectionFromItem(item);
      
      let value = '';
      
      // 日期类字段根据区块动态取值
      if (label.includes('开始时间') || label.includes('入学时间')) {
        if (section === 'education') {
          value = resume.education?.[0]?.start_date || '';
          console.log(`[快填] 教育区块开始时间: ${value}`);
        } else if (section === 'project') {
          value = resume.projects?.[0]?.start_date || '';
          console.log(`[快填] 项目区块开始时间: ${value}`);
        } else if (section === 'work') {
          value = resume.work_experience?.[0]?.start_date || '';
          console.log(`[快填] 实习区块开始时间: ${value}`);
        } else {
          // 默认使用教育经历
          value = resume.education?.[0]?.start_date || resume.work_experience?.[0]?.start_date || '';
        }
      } else if (label.includes('结束时间') || label.includes('毕业时间') || label.includes('离校时间')) {
        if (section === 'education') {
          value = resume.education?.[0]?.end_date || '';
          console.log(`[快填] 教育区块结束时间: ${value}`);
        } else if (section === 'project') {
          value = resume.projects?.[0]?.end_date || '';
          console.log(`[快填] 项目区块结束时间: ${value}`);
        } else if (section === 'work') {
          value = resume.work_experience?.[0]?.end_date || '';
          console.log(`[快填] 实习区块结束时间: ${value}`);
        } else {
          // 默认使用教育经历
          value = resume.education?.[0]?.end_date || resume.work_experience?.[0]?.end_date || '';
        }
      } else {
        // 其他字段使用原有映射表
        value = PHOENIX_SELECT_MAP[label]?.(resume) || '';
      }
      
      if (value) {
        console.log(`[快填] --------------------------------------------------`);
        console.log(`[快填] 处理字段 "${label}" (区块: ${section}): "${value}"`);
        const ok = await fillPhoenixSelect(phoenixSelect, value, label);
        if (ok) {
          filled++;
          console.log(`[快填] ✓ 字段 "${label}" 填充成功`);
        } else {
          failed++;
          console.log(`[快填] ✗ 字段 "${label}" 填充失败`);
        }
      }
      await sleep(400);
    }
    
    console.log(`[快填] ========== Phoenix 选择器填充完成 ==========`);
    console.log(`[快填] 成功: ${filled}, 失败: ${failed}`);
    return filled;
  };

  // 导出到全局
  window.fillAllPhoenixSelects = fillAllPhoenixSelects;
  window.fillPhoenixSelect = fillPhoenixSelect;
  
  console.log('[快填] phoenix-select-filler.js 模块加载完成（最终增强版）');
})();
