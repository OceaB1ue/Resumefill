// ===== 改进的 groupId 生成和多段经历处理 =====

// 改进的 getGroupInfo 函数
function getGroupInfo(el, allFields, fieldIndex) {
  if (IS_DEBUG) console.log(`[快填] 分析字段 #${fieldIndex} 的分组信息...`);
  
  // 策略1：查找最近的容器（data-index 优先）
  let container = el.closest('[data-index]');
  if (container) {
    const dataIndex = container.getAttribute('data-index');
    if (IS_DEBUG) console.log(`[快填] 通过 data-index 找到容器: ${dataIndex}`);
    return {
      groupId: `group-${dataIndex}`,
      groupIndex: parseInt(dataIndex) || fieldIndex
    };
  }
  
  // 策略2：查找具有特定类名的容器
  const containerSelectors = [
    '.form-group',
    '.form-item',
    '.field-group',
    '[role="group"]',
    '.item-container',
    '.entry-item',
    '.experience-item',
    '.education-item',
    '.work-item',
    '.project-item',
    '[class*="item"][class*="container"]',
    '[class*="form"][class*="item"]'
  ];
  
  for (const selector of containerSelectors) {
    container = el.closest(selector);
    if (container) {
      // 获取容器在其父级中的索引
      const parent = container.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(child => 
          child.matches(selector) || child.classList.toString() === container.classList.toString()
        );
        const index = siblings.indexOf(container);
        const className = container.className.split(' ')[0] || 'item';
        const groupId = `${className}-${index}`;
        if (IS_DEBUG) console.log(`[快填] 通过容器类名找到分组: ${groupId}`);
        return {
          groupId: groupId,
          groupIndex: index
        };
      }
    }
  }
  
  // 策略3：基于分区标题分组
  const sectionHeading = getSectionContext(el);
  const sectionFields = allFields.filter(f => getSectionContext(f.el) === sectionHeading);
  const indexInSection = sectionFields.indexOf(el);
  
  // 计算该分区内的条目索引（假设每个条目有相同数量的字段）
  const fieldsPerEntry = Math.max(1, Math.floor(sectionFields.length / 3)); // 假设最多3个条目
  const entryIndex = Math.floor(indexInSection / fieldsPerEntry);
  
  const groupId = `${sectionHeading}-entry-${entryIndex}`;
  if (IS_DEBUG) console.log(`[快填] 通过分区标题分组: ${groupId}`);
  
  return {
    groupId: groupId,
    groupIndex: entryIndex
  };
}

// 改进的 enhanceFieldFeatures 函数（集成新的 groupId 生成）
function enhanceFieldFeaturesImproved(fields, doc) {
  if (IS_DEBUG) console.log(`[快填] 开始增强 ${fields.length} 个字段的特征...`);
  
  return fields.map((f, idx) => {
    const el = f.el;
    const labels = [];
    const ariaLabel = el.getAttribute('aria-label') || '';
    const placeholder = el.getAttribute('placeholder') || '';
    
    // 收集关联的 label
    if (el.id) {
      const lbl = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) labels.push(lbl.textContent.trim());
    }
    const parentLabel = el.closest('label');
    if (parentLabel) labels.push(parentLabel.textContent.trim());
    
    // 收集 data-* 属性
    const dataAttrs = {};
    for (const attr of el.attributes || []) {
      if (attr.name.startsWith('data-')) {
        dataAttrs[attr.name] = attr.value;
      }
    }
    
    // 收集相邻文本
    const neighborTexts = [];
    let node = el.previousElementSibling;
    for (let i = 0; i < 2 && node; i++, node = node.previousElementSibling) {
      const text = node.textContent.trim().slice(0, 50);
      if (text) neighborTexts.push(text);
    }
    
    // 获取分区标题
    const sectionHeading = getSectionContext(el);
    
    // 简化的 DOM 路径
    const domPath = el.tagName.toLowerCase() + 
      (el.id ? `#${el.id}` : '') +
      (el.className ? `.${el.className.split(' ')[0]}` : '');
    
    // 使用改进的 groupId 生成
    const groupInfo = getGroupInfo(el, fields, idx);
    
    // 推断 groupType
    const groupType = sectionHeading.includes('教育') ? 'education' :
                      sectionHeading.includes('工作') || sectionHeading.includes('实习') ? 'work' :
                      sectionHeading.includes('项目') ? 'project' : 'basic';
    
    // 检测必填属性
    const isRequired = el.hasAttribute('required') || 
                      el.getAttribute('aria-required') === 'true' ||
                      /必填|required|\*/.test(labels.join(' ') + ' ' + placeholder);
    
    const enhanced = {
      id: f.id,
      type: f.type,
      labels: labels,
      placeholder: placeholder,
      aria_label: ariaLabel,
      data_attrs: dataAttrs,
      neighbor_texts: neighborTexts,
      section_heading: sectionHeading,
      dom_path: domPath,
      options: f.options || [],
      group_id: groupInfo.groupId,
      group_type: groupType,
      group_index: groupInfo.groupIndex,
      is_required: isRequired
    };
    
    if (IS_DEBUG && idx < 3) {
      console.log(`[快填] 字段 #${f.id}: groupId=${enhanced.group_id}, groupType=${enhanced.group_type}, required=${enhanced.is_required}`);
    }
    
    return enhanced;
  });
}

// 改进的多段经历自动添加处理
async function handleMultipleEntries(actions, fields) {
  if (!actions || actions.length === 0) {
    if (IS_DEBUG) console.log('[快填] 没有需要执行的操作');
    return;
  }
  
  if (IS_DEBUG) console.log(`[快填] 需要执行 ${actions.length} 个操作`);
  
  for (const action of actions) {
    if (action.type === 'add_entry') {
      if (IS_DEBUG) console.log(`[快填] 需要添加 ${action.count} 个 ${action.group_type} 条目`);
      
      // 查找该类型的第一个条目容器
      const firstEntryField = fields.find(f => f.group_type === action.group_type);
      if (!firstEntryField) {
        console.warn(`[快填] 未找到 ${action.group_type} 类型的字段`);
        continue;
      }
      
      // 改进的添加按钮查找策略
      const addButton = findAddButton(action.group_type, firstEntryField.el);
      
      if (addButton) {
        if (IS_DEBUG) console.log(`[快填] 找到添加按钮，点击 ${action.count} 次`);
        for (let i = 0; i < action.count; i++) {
          addButton.click();
          await sleep(800); // 等待新条目加载（增加等待时间）
        }
      } else {
        console.warn(`[快填] 未找到添加 ${action.group_type} 的按钮`);
      }
    }
  }
}

// 改进的添加按钮查找函数
function findAddButton(groupType, referenceEl) {
  // 策略1：在参考元素附近查找
  const container = referenceEl.closest('.form-group, .form-section, [class*="section"], [class*="group"]');
  if (container) {
    // 在容器内查找添加按钮
    const buttons = container.querySelectorAll('button, a[role="button"], .btn, [class*="button"], [class*="btn"]');
    for (const btn of buttons) {
      const text = btn.textContent.trim();
      // 匹配添加/新增相关的文本
      if (/添加|新增|Add|New|\+/.test(text)) {
        // 检查是否与当前分组类型相关
        if (isButtonForGroupType(text, groupType)) {
          return btn;
        }
      }
    }
  }
  
  // 策略2：全局查找（限制在表单区域内）
  const formContainer = referenceEl.closest('form, .form, .application-form, [class*="form"]');
  const searchScope = formContainer || document;
  
  const allButtons = searchScope.querySelectorAll('button, a[role="button"], .btn, [class*="button"], [class*="btn"], [class*="add"]');
  
  // 优先查找与分组类型明确相关的按钮
  for (const btn of allButtons) {
    const text = btn.textContent.trim();
    if (/添加|新增|Add|New|\+/.test(text) && isButtonForGroupType(text, groupType)) {
      return btn;
    }
  }
  
  // 策略3：查找任何包含"添加"或"新增"的按钮
  for (const btn of allButtons) {
    const text = btn.textContent.trim();
    if (/添加|新增|Add|New|\+/.test(text)) {
      return btn;
    }
  }
  
  // 策略4：查找带有添加图标的按钮
  const iconButtons = searchScope.querySelectorAll('[class*="icon-add"], [class*="icon-plus"], [class*="add-icon"], [class*="plus"]');
  for (const icon of iconButtons) {
    const btn = icon.closest('button, a[role="button"], .btn');
    if (btn) return btn;
  }
  
  return null;
}

// 判断按钮是否针对特定分组类型
function isButtonForGroupType(buttonText, groupType) {
  const typeKeywords = {
    'education': ['教育', '学历', '学校', 'Education', 'School'],
    'work': ['工作', '实习', '经历', 'Work', 'Experience', 'Intern'],
    'project': ['项目', 'Project'],
    'award': ['获奖', '奖项', '荣誉', 'Award'],
    'basic': ['基本信息', 'Basic']
  };
  
  const keywords = typeKeywords[groupType] || [];
  return keywords.some(kw => buttonText.includes(kw));
}

// 改进的字段匹配结果处理（包含置信度）
function processMatchResults(llmPlan, ruleMatched, fields) {
  const allMatches = {};
  const lowConfidenceFields = [];
  
  // 合并规则匹配结果（置信度 0.95）
  for (const [id, match] of Object.entries(ruleMatched)) {
    allMatches[id] = {
      ...match,
      confidence: 0.95,
      source: 'rule'
    };
  }
  
  // 合并 LLM 匹配结果
  for (const [idStr, v] of Object.entries(llmPlan)) {
    const id = Number(idStr);
    if (!allMatches[id] && v) {
      const confidence = v.confidence || 0.7;
      allMatches[id] = {
        ...v,
        confidence: confidence,
        source: v.source || 'llm'
      };
      
      // 记录低置信度字段
      if (confidence < 0.6) {
        lowConfidenceFields.push({
          id: id,
          confidence: confidence,
          value: v.value
        });
      }
    }
  }
  
  if (IS_DEBUG) console.log(`[快填] 匹配结果: ${Object.keys(allMatches).length} 个字段, 低置信度: ${lowConfidenceFields.length} 个`);
  
  return {
    allMatches,
    lowConfidenceFields
  };
}

// 处理未匹配字段（保存到记忆库供后续使用）
async function handleMissingFields(fields, allMatches, siteKey, resume) {
  const unmatchedFields = fields.filter(f => !allMatches[f.id]);
  
  if (unmatchedFields.length === 0) return;
  
  if (IS_DEBUG) console.log(`[快填] ${unmatchedFields.length} 个字段未匹配，保存到记忆库`);
  
  // 这里可以实现保存到记忆库的逻辑
  // 或者提示用户手动填写
}
