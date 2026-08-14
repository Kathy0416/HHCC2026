// 全局变量
let currentDate = new Date();
let selectedDate = null;
let calendarData = {};
let currentView = 'month'; // 'month' 或 'year'

// DOM元素
const calendarGrid = document.getElementById('calendar-grid');
const currentMonthYearEl = document.getElementById('current-month-year');
const prevMonthBtn = document.getElementById('prev-month');
const nextMonthBtn = document.getElementById('next-month');
const modal = document.getElementById('modal');
const modalDateEl = document.getElementById('modal-date');
const closeModalBtn = document.querySelector('.close-modal');
const saveEntryBtn = document.getElementById('save-entry');
const deleteEntryBtn = document.getElementById('delete-entry');
const migraineCheck = document.getElementById('migraine-check');
const diaryEntry = document.getElementById('diary-entry');
const container = document.querySelector('.container');
const yearViewContainer = document.getElementById('year-view');
const calendarContainer = document.querySelector('.calendar-container');
const triggersSection = document.querySelector('.triggers-section');
const triggerCheckboxes = document.querySelectorAll('.trigger-checkbox');
const triggerCategories = document.querySelectorAll('.trigger-category');

// 初始化应用
function init() {
    // 从本地存储加载数据
    loadCalendarData();
    // 渲染日历
    renderCalendar();
    // 添加事件监听
    addEventListeners();
    // 初始化液态玻璃效果
    initLiquidGlassEffect();
    
    if (triggerCategories.length > 2) {
        for (let i = 1; i < triggerCategories.length; i++) {
            triggerCategories[i].classList.add('collapsed');
        }
    }
}

// 切换到年视图
function toggleYearView() {
    if (currentView === 'month') {
        currentView = 'year';
        renderYearView();
        // 隐藏月视图，显示年视图
        calendarContainer.style.display = 'none';
        yearViewContainer.style.display = 'block';
        // 更改标题文本
        currentMonthYearEl.textContent = `${currentDate.getFullYear()}年`;
        // 隐藏月份导航按钮
        prevMonthBtn.textContent = '‹';
        nextMonthBtn.textContent = '›';
    } else {
        // 切换回月视图
        currentView = 'month';
        renderCalendar();
        // 显示月视图，隐藏年视图
        calendarContainer.style.display = 'block';
        yearViewContainer.style.display = 'none';
        // 恢复月份导航按钮
        prevMonthBtn.textContent = '‹';
        nextMonthBtn.textContent = '›';
    }
}

// 渲染年视图
function renderYearView() {
    yearViewContainer.innerHTML = '';
    
    const year = currentDate.getFullYear();
    const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    
    // 创建月份网格容器
    const monthsGrid = document.createElement('div');
    monthsGrid.className = 'months-grid';
    
    // 渲染12个月
    for (let month = 0; month < 12; month++) {
        const monthCard = document.createElement('div');
        monthCard.className = 'month-card';
        
        // 月份标题
        const monthTitle = document.createElement('h4');
        monthTitle.textContent = monthNames[month];
        monthCard.appendChild(monthTitle);
        
        // 星期标签（可选，为了布局对称）
            const weekLabels = document.createElement('div');
            weekLabels.className = 'month-days week-labels';
            const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
            weekDays.forEach(day => {
                const label = document.createElement('div');
                label.textContent = day;
                label.style.fontSize = '0.7rem';
                label.style.color = 'var(--text-secondary)';
                label.style.opacity = '0.7';
                label.style.height = '16px'; // 减小高度
                label.style.display = 'flex';
                label.style.alignItems = 'center';
                label.style.justifyContent = 'center';
                weekLabels.appendChild(label);
            });
        monthCard.appendChild(weekLabels);
        
        // 日期网格
        const daysGrid = document.createElement('div');
        daysGrid.className = 'month-days';
        
        // 获取该月的第一天和最后一天
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        
        // 上个月的最后几天
        const prevMonthLastDay = new Date(year, month, 0);
        const prevMonthDays = firstDay.getDay(); // 0-6
        
        // 填充上个月的日期
        for (let i = prevMonthDays - 1; i >= 0; i--) {
            const dayNum = prevMonthLastDay.getDate() - i;
            const dayEl = document.createElement('div');
            dayEl.className = 'month-day other-month';
            dayEl.textContent = dayNum;
            daysGrid.appendChild(dayEl);
        }
        
        // 填充当月的日期
        const today = new Date();
        const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year;
        
        for (let i = 1; i <= lastDay.getDate(); i++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            const hasMigraine = calendarData[dateStr]?.migraine || false;
            const isToday = isCurrentMonth && today.getDate() === i;
            
            const dayEl = document.createElement('div');
            dayEl.className = `month-day ${isToday ? 'current-day' : ''}`;
            dayEl.dataset.date = dateStr;
            
            // 日期数字容器
            const dateNumber = document.createElement('span');
            dateNumber.textContent = i;
            dayEl.appendChild(dateNumber);
            
            // 如果有偏头痛，添加红点在日期下方
            if (hasMigraine) {
                const migraineDot = document.createElement('div');
                migraineDot.className = 'migraine-dot';
                dayEl.appendChild(migraineDot);
            }
            
            // 添加点击事件
            dayEl.addEventListener('click', () => {
                // 切换回月视图并打开该日期的模态框
                currentDate.setMonth(month);
                currentDate.setDate(i);
                toggleYearView();
                openModal(dateStr);
            });
            
            daysGrid.appendChild(dayEl);
        }
        
        monthCard.appendChild(daysGrid);
        monthsGrid.appendChild(monthCard);
    }
    
    yearViewContainer.appendChild(monthsGrid);
}

// 处理导航按钮点击（月视图/年视图）
function handleNavigation() {
    if (currentView === 'year') {
        // 年视图下导航切换年份
        if (this === prevMonthBtn) {
            currentDate.setFullYear(currentDate.getFullYear() - 1);
        } else {
            currentDate.setFullYear(currentDate.getFullYear() + 1);
        }
        renderYearView();
        currentMonthYearEl.textContent = `${currentDate.getFullYear()}年`;
    } else {
        // 月视图下正常切换月份
        if (this === prevMonthBtn) {
            goToPrevMonth();
        } else {
            goToNextMonth();
        }
    }
}

// 添加液态玻璃效果的交互
function initLiquidGlassEffect() {
    // 为body添加鼠标移动事件来模拟液态玻璃的流动效果
    document.addEventListener('mousemove', function(e) {
        const x = e.clientX / window.innerWidth;
        const y = e.clientY / window.innerHeight;
        
        // 计算鼠标位置的偏移量
        const moveX = (x - 0.5) * 30;
        const moveY = (y - 0.5) * 30;
        
        // 为所有玻璃效果元素添加微小的位移和背景变化
        document.querySelectorAll('.glass-effect, .calendar-glass, .modal-content').forEach(element => {
            // 使用不同的强度为不同元素添加效果，创造层次感
            let intensity = 1;
            if (element.classList.contains('calendar-glass')) intensity = 0.8;
            if (element.classList.contains('modal-content')) intensity = 0.5;
            
            // 应用变换和背景位置调整
            element.style.transform = `translate(${moveX * intensity * 0.1}px, ${moveY * intensity * 0.1}px)`;
            element.style.backgroundPosition = `${moveX * intensity * 0.05}px ${moveY * intensity * 0.05}px`;
            
            // 添加微小的背景光效果
            const gradientX = x * 100;
            const gradientY = y * 100;
            element.style.background = `radial-gradient(circle at ${gradientX}% ${gradientY}%, rgba(13, 71, 161, 0.15), transparent 80%), 
                                       var(--glass-bg)`;
        });
        
        // 为背景添加动态效果
        document.body.style.backgroundPosition = `${moveX * 0.2}px ${moveY * 0.2}px`;
    });
    
    // 鼠标离开时的重置效果
    document.addEventListener('mouseleave', function() {
        document.querySelectorAll('.glass-effect, .calendar-glass, .modal-content').forEach(element => {
            element.style.transition = 'all 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
            element.style.transform = 'translate(0, 0)';
            element.style.background = 'var(--glass-bg)';
            
            // 重置过渡效果
            setTimeout(() => {
                element.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
            }, 800);
        });
        
        document.body.style.transition = 'background-position 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
        document.body.style.backgroundPosition = '0 0';
        
        setTimeout(() => {
            document.body.style.transition = 'none';
        }, 800);
    });
}

// 渲染日历
function renderCalendar() {
    // 清空日历网格
    calendarGrid.innerHTML = '';
    
    // 设置当前月份和年份显示
    const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    currentMonthYearEl.textContent = `${currentDate.getFullYear()}年 ${monthNames[currentDate.getMonth()]}`;
    
    // 获取当月的第一天和最后一天
    const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    
    // 获取上个月的最后几天（用于填充日历开头）
    const prevMonthLastDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0);
    const prevMonthDays = firstDay.getDay(); // 当月第一天是星期几（0-6）
    
    // 获取下个月的开始几天（用于填充日历结尾）
    const nextMonthDays = 6 - lastDay.getDay(); // 当月最后一天之后需要显示的天数
    
    // 渲染上个月的日期
    for (let i = prevMonthDays - 1; i >= 0; i--) {
        const day = prevMonthLastDay.getDate() - i;
        const dateStr = `${prevMonthLastDay.getFullYear()}-${String(prevMonthLastDay.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const hasMigraine = calendarData[dateStr]?.migraine || false;
        
        const dayCell = createDayCell(day, dateStr, 'other-month', hasMigraine);
        calendarGrid.appendChild(dayCell);
    }
    
    // 渲染当月的日期
    const today = new Date();
    const isCurrentMonth = today.getMonth() === currentDate.getMonth() && today.getFullYear() === currentDate.getFullYear();
    
    for (let i = 1; i <= lastDay.getDate(); i++) {
        const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const hasMigraine = calendarData[dateStr]?.migraine || false;
        const isToday = isCurrentMonth && today.getDate() === i;
        
        const dayCell = createDayCell(i, dateStr, isToday ? 'current-day' : '', hasMigraine);
        calendarGrid.appendChild(dayCell);
    }
    
    // 渲染下个月的日期
    for (let i = 1; i <= nextMonthDays; i++) {
        const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 2).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const hasMigraine = calendarData[dateStr]?.migraine || false;
        
        const dayCell = createDayCell(i, dateStr, 'other-month', hasMigraine);
        calendarGrid.appendChild(dayCell);
    }
}

// 创建日历单元格
function createDayCell(dayNumber, dateStr, additionalClass, hasMigraine) {
    const cell = document.createElement('div');
    cell.className = `day-cell ${additionalClass || ''} ${hasMigraine ? 'has-migraine' : ''}`;
    cell.dataset.date = dateStr;
    
    const dayNumSpan = document.createElement('span');
    dayNumSpan.className = 'day-number';
    dayNumSpan.textContent = dayNumber;
    
    const migraineIndicator = document.createElement('span');
    migraineIndicator.className = 'migraine-indicator';
    
    // 检查是否有日记内容并添加指示器
    const hasDiary = calendarData[dateStr]?.diary && calendarData[dateStr].diary.trim() !== '';
    if (hasDiary) {
        const diaryIndicator = document.createElement('span');
        diaryIndicator.className = 'diary-indicator';
        diaryIndicator.style.width = '4px';
        diaryIndicator.style.height = '4px';
        diaryIndicator.style.backgroundColor = 'var(--accent-silver)';
        diaryIndicator.style.borderRadius = '50%';
        diaryIndicator.style.marginTop = '3px';
        cell.appendChild(diaryIndicator);
    }
    
    cell.appendChild(dayNumSpan);
    cell.appendChild(migraineIndicator);
    
    // 添加点击事件
    cell.addEventListener('click', () => openModal(dateStr));
    
    return cell;
}

// 打开模态框
function openModal(dateStr) {
    selectedDate = dateStr;
    
    // 格式化日期显示
    const [year, month, day] = dateStr.split('-');
    const formattedDate = `${year}年${month}月${day}日`;
    modalDateEl.textContent = formattedDate;
    
    // 加载现有数据
    const existingData = calendarData[dateStr] || { migraine: false, diary: '', triggers: [] };
    migraineCheck.checked = existingData.migraine;
    diaryEntry.value = existingData.diary || '';
    
    // 加载触发因素
    loadTriggers(existingData.triggers || []);
    
    // 更新触发因素区域显示状态
    updateTriggersVisibility();
    
    // 显示模态框
    modal.style.display = 'flex';
    
    // 自动聚焦到日记输入框
    setTimeout(() => diaryEntry.focus(), 300);
}

// 更新触发因素区域显示状态
function updateTriggersVisibility() {
    // 只隐藏触发因素选择部分，不隐藏日记输入框
    triggersSection.style.display = migraineCheck.checked ? 'block' : 'none';
    // diaryEntry textarea is always visible
}

// 清空所有触发因素选择
function clearTriggers() {
    document.querySelectorAll('.trigger-checkbox').forEach(checkbox => {
        checkbox.checked = false;
    });
}

// 加载触发因素选择
function loadTriggers(triggers) {
    clearTriggers();
    triggers.forEach(trigger => {
        const checkbox = document.querySelector(`.trigger-checkbox[data-trigger="${trigger}"]`);
        if (checkbox) {
            checkbox.checked = true;
        }
    });
}

// 获取所有选中的触发因素
function getSelectedTriggers() {
    const selected = [];
    document.querySelectorAll('.trigger-checkbox:checked').forEach(checkbox => {
        selected.push(checkbox.dataset.trigger);
    });
    return selected;
}

// 关闭模态框
function closeModal() {
    modal.style.display = 'none';
    selectedDate = null;
    
    // 重置表单
    migraineCheck.checked = false;
    diaryEntry.value = '';
}

// 保存日历条目
function saveCalendarEntry() {
    if (!selectedDate) return;
    
    // 保存数据
    calendarData[selectedDate] = {
        migraine: migraineCheck.checked,
        diary: diaryEntry.value.trim(),
        triggers: getSelectedTriggers(),
        lastUpdated: new Date().toISOString()
    };
    
    // 保存到本地存储
    saveCalendarData();
    
    // 重新渲染日历
    renderCalendar();
    
    // 显示成功消息
    showNotification('保存成功！', 'success');
    
    // 关闭模态框
    closeModal();
}

// 删除日历条目
function deleteCalendarEntry() {
    if (!selectedDate) return;
    
    if (confirm('确定要删除这条记录吗？此操作无法撤销。')) {
        // 删除数据
        delete calendarData[selectedDate];
        
        // 保存到本地存储
        saveCalendarData();
        
        // 重新渲染日历
        renderCalendar();
        
        // 显示成功消息
        showNotification('记录已删除。', 'info');
        
        // 关闭模态框
        closeModal();
    }
}

// 显示通知
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(30, 30, 30, 0.9);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(176, 190, 197, 0.2);
        border-radius: 8px;
        padding: 12px 24px;
        color: var(--text-primary);
        z-index: 2000;
        animation: slideUp 0.3s ease-out;
        font-weight: 500;
    `;
    
    // 根据类型设置不同的左边框颜色
    if (type === 'success') {
        notification.style.borderLeft = '4px solid #4caf50';
    } else if (type === 'error') {
        notification.style.borderLeft = '4px solid var(--migraine-red)';
    } else {
        notification.style.borderLeft = '4px solid var(--accent-blue)';
    }
    
    document.body.appendChild(notification);
    
    // 添加动画样式
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateX(-50%) translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
        }
    `;
    document.head.appendChild(style);
    
    // 3秒后移除通知
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(-50%) translateY(20px)';
        notification.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        
        setTimeout(() => {
            document.body.removeChild(notification);
            if (document.head.contains(style)) {
                document.head.removeChild(style);
            }
        }, 300);
    }, 3000);
}

// 保存日历数据到本地存储
function saveCalendarData() {
    localStorage.setItem('migraineCalendarData', JSON.stringify(calendarData));
}

// 从本地存储加载日历数据
function loadCalendarData() {
    const savedData = localStorage.getItem('migraineCalendarData');
    if (savedData) {
        try {
            calendarData = JSON.parse(savedData);
        } catch (e) {
            console.error('加载日历数据失败:', e);
            calendarData = {};
        }
    }
}

// 切换到上个月
function goToPrevMonth() {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar();
}

// 切换到下个月
function goToNextMonth() {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar();
}

// 添加事件监听
function addEventListeners() {
    // 月份切换按钮（使用统一的处理函数）
    prevMonthBtn.addEventListener('click', handleNavigation);
    nextMonthBtn.addEventListener('click', handleNavigation);
    
    // 月份标题点击切换年视图
    currentMonthYearEl.addEventListener('click', toggleYearView);
    
    // 模态框控制
    closeModalBtn.addEventListener('click', closeModal);
    saveEntryBtn.addEventListener('click', saveCalendarEntry);
    deleteEntryBtn.addEventListener('click', deleteCalendarEntry);
    
    // 监听偏头痛复选框变化
    migraineCheck.addEventListener('change', updateTriggersVisibility);
    
    // 点击模态框外部关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });
    
    // ESC键关闭模态框
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeModal();
        }
    });
    
    // 回车键保存（当焦点在日记输入框时）
    diaryEntry.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            saveCalendarEntry();
        }
    });
    
    // 添加键盘快捷键提示
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + ← 上一月
        if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowLeft') {
            goToPrevMonth();
        }
        // Ctrl/Cmd + → 下一月
        else if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowRight') {
            goToNextMonth();
        }
    });
    
    // 触发因素分类折叠面板交互
    triggerCategories.forEach(category => {
        const header = category.querySelector('h5');
        header.addEventListener('click', () => {
            category.classList.toggle('collapsed');
        });
    });
}

// 初始化应用
init();