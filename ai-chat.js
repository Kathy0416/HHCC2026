// AI聊天功能实现

// DOM元素
const chatBubbleBtn = document.getElementById('chat-bubble-btn');
const chatContainer = document.getElementById('chat-container');
const closeChatBtn = document.getElementById('close-chat-btn');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');

// 聊天历史记录
let chatHistory = [];

// DeepSeek API 配置（请在部署前替换为真实KEY）
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
let DEEPSEEK_API_KEY = localStorage.getItem('deepseekApiKey') || 'YOUR_DEEPSEEK_API_KEY';
const DEEPSEEK_MODEL = 'deepseek-chat';

function setDeepSeekApiKey(key) {
    if (key && key.trim()) {
        const trimmedKey = key.trim();
        localStorage.setItem('deepseekApiKey', trimmedKey);
        DEEPSEEK_API_KEY = trimmedKey;
    }
}

// 初始化聊天功能
function initChat() {
    // 添加事件监听
    addChatEventListeners();
    // 加载聊天历史（如果有）
    loadChatHistory();
    // 深度查询API key配置
    setupDeepSeekConfig();
}

function setupDeepSeekConfig() {
    const apiKeyInput = document.getElementById('deepseek-api-key-input');
    const apiKeySaveBtn = document.getElementById('save-api-key-btn');
    if (!apiKeyInput || !apiKeySaveBtn) return;

    apiKeyInput.value = localStorage.getItem('deepseekApiKey') || '';

    apiKeySaveBtn.addEventListener('click', () => {
        const value = apiKeyInput.value.trim();
        if (!value) {
            alert('请输入 DeepSeek API Key');
            return;
        }
        setDeepSeekApiKey(value);
        alert('已保存 DeepSeek API Key，下一次请求将使用该Key。');
    });
}

// 添加聊天事件监听
function addChatEventListeners() {
    // 聊天气泡按钮点击事件
    chatBubbleBtn.addEventListener('click', toggleChat);
    
    // 关闭聊天按钮点击事件
    closeChatBtn.addEventListener('click', toggleChat);
    
    // 发送按钮点击事件
    sendBtn.addEventListener('click', sendMessage);
    
    // 输入框回车发送消息
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // 输入框自动调整高度
    chatInput.addEventListener('input', autoResizeTextarea);
    
    // 点击聊天界面外部关闭聊天
    document.addEventListener('click', (e) => {
        if (chatContainer.classList.contains('visible') && 
            !chatContainer.contains(e.target) && 
            e.target !== chatBubbleBtn) {
            toggleChat();
        }
    });
}

// 切换聊天界面显示/隐藏
function toggleChat() {
    chatContainer.classList.toggle('visible');
    
    // 如果聊天界面显示，聚焦到输入框
    if (chatContainer.classList.contains('visible')) {
        setTimeout(() => chatInput.focus(), 300);
    }
}

// 自动调整输入框高度
function autoResizeTextarea() {
    // 重置高度，以便正确计算滚动高度
    chatInput.style.height = 'auto';
    // 设置新高度，限制最大高度
    const newHeight = Math.min(chatInput.scrollHeight, 120);
    chatInput.style.height = `${newHeight}px`;
}

// 发送消息
async function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;
    
    // 清空输入框
    chatInput.value = '';
    // 重置输入框高度
    chatInput.style.height = 'auto';
    
    // 显示用户消息
    displayMessage(message, 'user');
    
    // 添加到聊天历史
    addToChatHistory(message, 'user');
    
    // AI 功能须联网使用（走后端代理），未连接服务器时禁用并提示
    if (!window.ApiClient || !(await window.ApiClient.health())) {
        const offlineTip = window.I18n ? window.I18n.t('ai.offline') : '该功能须联网使用';
        displayMessage(offlineTip, 'ai');
        addToChatHistory(offlineTip, 'ai');
        saveChatHistory();
        return;
    }
    
    // 发送消息给AI并获取回复
    getAIResponse(message);
}

// 简单的 Markdown 渲染（支持加粗、换行、标题、列表），并转义 HTML 防 XSS
function renderMarkdown(text) {
    if (!text) return '';
    let html = String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    // 加粗 **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    // 标题 # / ## / ###
    html = html.replace(/^#{1,3}\s+(.+)$/gm, '<b>$1</b>');
    // 无序列表 - / *
    html = html.replace(/^[-*]\s+(.+)$/gm, '• $1');
    // 有序列表 1. / 2.
    html = html.replace(/^\d+\.\s+(.+)$/gm, '$1');
    // 换行
    html = html.replace(/\n/g, '<br>');

    return html;
}

// 显示消息
function displayMessage(text, sender) {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${sender}`;
    messageEl.setAttribute('data-i18n-skip', '');
    messageEl.setAttribute('data-user-content', '');

    if (sender === 'ai') {
        // AI 消息：渲染 Markdown
        messageEl.innerHTML = renderMarkdown(text);
    } else {
        // 用户消息：转义 HTML + 保留换行
        const escaped = String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        messageEl.innerHTML = escaped.replace(/\n/g, '<br>');
    }

    chatMessages.appendChild(messageEl);

    // 滚动到底部
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 显示AI正在输入的状态
function displayTypingIndicator() {
    const typingEl = document.createElement('div');
    typingEl.className = 'message ai typing';
    typingEl.innerHTML = `
        <div class="typing-indicator">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        </div>
    `;
    
    chatMessages.appendChild(typingEl);
    
    // 滚动到底部
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    return typingEl;
}

// 移除正在输入的状态
function removeTypingIndicator(typingEl) {
    if (typingEl && typingEl.parentNode) {
        typingEl.parentNode.removeChild(typingEl);
    }
}

// 获取AI回复（DeepSeek优先，失败回退模拟）
async function getAIResponse(userMessage) {
    // 显示正在输入的状态
    const typingEl = displayTypingIndicator();

    try {
        const aiResponse = await callAIAPI(userMessage);
        removeTypingIndicator(typingEl);
        displayMessage(aiResponse, 'ai');
        addToChatHistory(aiResponse, 'ai');
        saveChatHistory();
    } catch (error) {
        console.error('AI 回复失败：', error);
        removeTypingIndicator(typingEl);

        const fallbackResponse = window.I18n ? window.I18n.t('ai.unavailable') : 'AI 服务暂时不可用，请稍后再试';
        displayMessage(fallbackResponse, 'ai');
        addToChatHistory(fallbackResponse, 'ai');
        saveChatHistory();
    }
}

// 生成模拟AI回复
function generateMockAIResponse(userMessage) {
    // 简单的关键词匹配回复
    const lowerMessage = userMessage.toLowerCase();
    
    // 偏头痛相关回复
    if (lowerMessage.includes('偏头痛') || lowerMessage.includes('头痛')) {
        return '偏头痛是一种常见的神经系统疾病，特征是反复发作的中重度头痛，通常伴有恶心、呕吐、对光和声音敏感。建议保持规律的作息、避免触发因素，如压力、缺乏睡眠、某些食物等。如果症状严重，建议咨询医生。';
    }
    
    // 食物触发因素相关回复
    if (lowerMessage.includes('吃了') || lowerMessage.includes('食物') || lowerMessage.includes('巧克力') || lowerMessage.includes('咖啡') || lowerMessage.includes('酒精') || lowerMessage.includes('不舒服')) {
        return '某些食物确实可能触发偏头痛，常见的包括巧克力、咖啡因、酒精、含有硝酸盐的食物等。如果你刚吃完巧克力后感到不舒服，建议：1. 休息在安静黑暗的房间；2. 多喝水帮助代谢；3. 记录这次发作，以便识别个人触发因素；4. 如果症状严重，可服用止痛药。';
    }
    
    // 触发因素相关回复
    if (lowerMessage.includes('触发因素') || lowerMessage.includes('原因') || lowerMessage.includes('为什么')) {
        return '偏头痛的常见触发因素包括：压力、睡眠不足或过多、饮食因素（如酒精、咖啡因、巧克力、硝酸盐等）、荷尔蒙变化、环境因素（如强光、噪音、天气变化）等。';
    }
    
    // 治疗方法相关回复
    if (lowerMessage.includes('治疗') || lowerMessage.includes('缓解') || lowerMessage.includes('怎么办') || lowerMessage.includes('怎么治')) {
        return '偏头痛的治疗包括：休息在安静、黑暗的房间，服用止痛药（如布洛芬、对乙酰氨基酚），避免触发因素，保持规律的生活习惯，尝试放松技巧（如深呼吸、冥想），严重时可使用处方药。';
    }
    
    // 记录相关回复
    if (lowerMessage.includes('记录') || lowerMessage.includes('日记') || lowerMessage.includes('跟踪')) {
        return '记录偏头痛发作情况有助于识别触发因素和规律。建议记录发作时间、持续时间、疼痛程度、伴随症状、当天的饮食、睡眠、压力水平等信息。';
    }
    
    // 症状相关回复
    if (lowerMessage.includes('症状') || lowerMessage.includes('表现') || lowerMessage.includes('感觉')) {
        return '偏头痛的典型症状包括：单侧搏动性头痛、中重度疼痛、恶心呕吐、对光和声音敏感、有时伴有视觉先兆（如闪光、暗点）等。症状通常持续4-72小时。';
    }
    
    // 苹果/食物相关
    if (lowerMessage.includes('苹果') || lowerMessage.includes('水果')) {
        return '苹果通常被认为是健康食品，不是偏头痛的典型触发因素。建议观察自身反应，如果你有明确关联，可以继续记录；否则继续保持均衡饮食与规律作息。';
    }

    // 其他情况
    return '抱歉，我不太明白你的问题。我是一个专注于偏头痛相关问题的AI助手，你可以问我关于偏头痛的症状、触发因素、治疗方法等问题。如果你希望测试 DeepSeek 实际回答，请检查 API Key 是否已输入并保存，控制台看是否有网络请求。';
}

// 添加到聊天历史
function addToChatHistory(text, sender) {
    chatHistory.push({
        text: text,
        sender: sender,
        timestamp: new Date().toISOString()
    });
    
    // 限制聊天历史长度
    if (chatHistory.length > 50) {
        chatHistory.shift();
    }
}

// 保存聊天历史到本地存储
function saveChatHistory() {
    localStorage.setItem('aiChatHistory', JSON.stringify(chatHistory));
}

// 从本地存储加载聊天历史
function loadChatHistory() {
    const savedHistory = localStorage.getItem('aiChatHistory');
    if (savedHistory) {
        try {
            chatHistory = JSON.parse(savedHistory);
            
            // 显示聊天历史
            chatHistory.forEach(message => {
                displayMessage(message.text, message.sender);
            });
        } catch (e) {
            console.error('加载聊天历史失败:', e);
            chatHistory = [];
        }
    }
}

// 调用后端 AI 代理（密钥保存在服务端，AI 功能须联网使用）
async function callAIAPI(message) {
    if (!window.ApiClient || !(await window.ApiClient.health())) {
        throw new Error('OFFLINE');
    }

    const history = chatHistory.map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text
    }));

    const data = await window.ApiClient.chat(message, history);
    if (data && data.reply) {
        return data.reply;
    }

    throw new Error('后端未返回有效回复');
}

// 初始化聊天功能
initChat();

// 导出函数，方便在其他页面调用
// function showChat() {
//     chatContainer.classList.add('visible');
//     setTimeout(() => chatInput.focus(), 300);
// }
