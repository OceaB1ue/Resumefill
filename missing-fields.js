// ===== 缺失信息补全功能 =====

// 检测必填字段
function isRequiredField(el, hint) {
  // 检查 required 属性
  if (el.hasAttribute('required') || el.getAttribute('aria-required') === 'true') {
    return true;
  }
  
  // 检查 hint 中的必填标记
  const requiredPatterns = ['必填', 'required', '*', '（必填）', '(required)'];
  const hintLower = hint.toLowerCase();
  return requiredPatterns.some(p => hintLower.includes(p.toLowerCase()));
}

// 检测缺失字段
function detectMissingFields(fields, allMatches) {
  const missing = [];
  
  for (const field of fields) {
    const matched = allMatches[field.id];
    
    // 如果字段未被填充且是必填的
    if (!matched && isRequiredField(field.el, field.hint)) {
      missing.push({
        id: field.id,
        hint: field.hint,
        type: field.type,
        el: field.el,
        section: field.section || 'basic'
      });
    }
  }
  
  return missing;
}

// 显示缺失信息补全面板
async function showMissingFieldsPanel(missingFields, fields, siteKey, resume) {
  return new Promise((resolve) => {
    // 创建面板容器
    const panel = document.createElement('div');
    panel.id = 'rqf-missing-panel';
    panel.style.cssText = [
      'position:fixed', 'bottom:100px', 'right:18px', 'z-index:2147483646',
      'background:#1a1d27', 'border:2px solid #6c63ff', 'border-radius:12px',
      'padding:16px', 'min-width:300px', 'max-width:400px', 'max-height:500px',
      'overflow-y:auto', 'box-shadow:0 8px 30px rgba(0,0,0,.5)',
      'font-family:-apple-system,BlinkMacSystemFont,PingFang SC,sans-serif',
      'color:#e2e8f0', 'font-size:13px'
    ].join(';');
    
    // 标题
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:700;margin-bottom:12px;color:#a78bfa;font-size:14px;';
    title.textContent = `⚠️ 缺失 ${missingFields.length} 个必填字段`;
    panel.appendChild(title);
    
    // 输入表单
    const form = document.createElement('div');
    const inputs = {};
    
    for (const field of missingFields) {
      const row = document.createElement('div');
      row.style.cssText = 'margin-bottom:10px;';
      
      const label = document.createElement('label');
      label.style.cssText = 'display:block;font-size:12px;color:#8892a4;margin-bottom:4px;';
      label.textContent = field.hint.slice(0, 50);
      row.appendChild(label);
      
      const input = document.createElement('input');
      input.type = field.type === 'textarea' ? 'textarea' : 'text';
      input.placeholder = `请输入${field.hint}`;
      input.style.cssText = [
        'width:100%', 'padding:6px 8px', 'background:#222536', 'border:1px solid #2e3248',
        'border-radius:6px', 'color:#e2e8f0', 'font-size:12px', 'box-sizing:border-box',
        'font-family:inherit'
      ].join(';');
      input.dataset.fieldId = field.id;
      row.appendChild(input);
      
      form.appendChild(row);
      inputs[field.id] = input;
    }
    
    panel.appendChild(form);
    
    // 按钮行
    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display:flex;gap:8px;margin-top:12px;';
    
    const submitBtn = document.createElement('button');
    submitBtn.textContent = '确认填充';
    submitBtn.style.cssText = [
      'flex:1', 'padding:8px 12px', 'background:#6c63ff', 'color:#fff',
      'border:none', 'border-radius:6px', 'cursor:pointer', 'font-size:12px',
      'font-weight:600', 'transition:background 0.2s'
    ].join(';');
    submitBtn.onmouseover = () => submitBtn.style.background = '#7c73ff';
    submitBtn.onmouseout = () => submitBtn.style.background = '#6c63ff';
    
    const skipBtn = document.createElement('button');
    skipBtn.textContent = '跳过';
    skipBtn.style.cssText = [
      'flex:1', 'padding:8px 12px', 'background:#2e3248', 'color:#e2e8f0',
      'border:1px solid #3e4258', 'border-radius:6px', 'cursor:pointer', 'font-size:12px',
      'transition:background 0.2s'
    ].join(';');
    skipBtn.onmouseover = () => skipBtn.style.background = '#3e4258';
    skipBtn.onmouseout = () => skipBtn.style.background = '#2e3248';
    
    buttonRow.appendChild(submitBtn);
    buttonRow.appendChild(skipBtn);
    panel.appendChild(buttonRow);
    
    // 添加到页面
    document.documentElement.appendChild(panel);
    
    // 事件处理
    submitBtn.onclick = async () => {
      console.log('[快填] 用户提交缺失信息');
      
      // 收集输入值
      const values = {};
      for (const [fieldId, input] of Object.entries(inputs)) {
        const value = input.value.trim();
        if (value) {
          values[fieldId] = value;
          
          // 保存到记忆库
          const field = missingFields.find(f => f.id === Number(fieldId));
          if (field) {
            chrome.runtime.sendMessage({
              type: 'SAVE_FIELD_MEMORY',
              siteKey,
              fieldKey: normalizeHint(field.hint),
              hint: field.hint,
              value: value
            }).catch(() => {});
          }
        }
      }
      
      // 填充到对应字段
      for (const [fieldId, value] of Object.entries(values)) {
        const field = missingFields.find(f => f.id === Number(fieldId));
        if (field) {
          try {
            if (field.type === 'custom-select') {
              await tryFillCustomSelectEnhanced(field.el, value, field.id);
            } else {
              await setFieldValue(field.el, value);
            }
            console.log(`[快填] 已填充缺失字段 #${fieldId}: "${value}"`);
          } catch(e) {
            console.warn(`[快填] 填充缺失字段失败:`, e.message);
          }
        }
      }
      
      panel.remove();
      resolve(true);
    };
    
    skipBtn.onclick = () => {
      console.log('[快填] 用户跳过缺失信息补全');
      panel.remove();
      resolve(false);
    };
    
    // 自动聚焦第一个输入框
    const firstInput = Object.values(inputs)[0];
    if (firstInput) firstInput.focus();
  });
}

// 在 smartFill 中集成缺失信息检测
// 在填充完成后调用此函数
async function handleMissingFields(fields, allMatches, siteKey, resume) {
  const missingFields = detectMissingFields(fields, allMatches);
  
  if (missingFields.length === 0) {
    console.log('[快填] 没有缺失的必填字段');
    return;
  }
  
  console.log(`[快填] 检测到 ${missingFields.length} 个缺失的必填字段`);
  
  // 显示补全面板
  const userCompleted = await showMissingFieldsPanel(missingFields, fields, siteKey, resume);
  
  if (userCompleted) {
    showToast('缺失信息已补全', 'ok');
  }
}
