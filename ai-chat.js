const chatBubbleBtn = document.getElementById('chat-bubble-btn');
const chatContainer = document.getElementById('chat-container');
const closeChatBtn = document.getElementById('close-chat-btn');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');

let chatHistory = [];

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

function initChat() {
    addChatEventListeners();
    loadChatHistory();
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

// 聊天事件监听
function addChatEventListeners() {
    chatBubbleBtn.addEventListener('click', toggleChat);
    closeChatBtn.addEventListener('click', toggleChat);
    sendBtn.addEventListener('click', sendMessage);
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

// 聊天界面显示
function toggleChat() {
    chatContainer.classList.toggle('visible');
    
    // 聚焦到输入框
    if (chatContainer.classList.contains('visible')) {
        setTimeout(() => chatInput.focus(), 300);
    }
}

// 自动调整输入框高度
function autoResizeTextarea() {
    chatInput.style.height = 'auto';
    const newHeight = Math.min(chatInput.scrollHeight, 120);
    chatInput.style.height = `${newHeight}px`;
}

// 发送消息
function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;
    chatInput.value = '';
    chatInput.style.height = 'auto';
    displayMessage(message, 'user');
    addToChatHistory(message, 'user');
    getAIResponse(message);
}

// 显示消息
function displayMessage(text, sender) {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${sender}`;
    messageEl.textContent = text;
    
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

// 获取AI回复
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
        console.error('AI回复失败，使用本地模拟：', error);
        removeTypingIndicator(typingEl);

        const errorTip = '（DeepSeek 调用失败，已回退本地模拟回复）';
        const fallbackResponse = `${generateMockAIResponse(userMessage)}\n\n${errorTip}`;
        displayMessage(fallbackResponse, 'ai');
        addToChatHistory(fallbackResponse, 'ai');
        saveChatHistory();
    }
}

// 调用失败时的假回复
function generateMockAIResponse(userMessage) {
    const lowerMessage = userMessage.toLowerCase();
    if (lowerMessage.includes('偏头痛') || lowerMessage.includes('头痛')) {
        return '偏头痛是一种常见的神经系统疾病，特征是反复发作的中重度头痛，通常伴有恶心、呕吐、对光和声音敏感。建议保持规律的作息、避免触发因素，如压力、缺乏睡眠、某些食物等。如果症状严重，建议咨询医生。';
    }
    if (lowerMessage.includes('吃了') || lowerMessage.includes('食物') || lowerMessage.includes('巧克力') || lowerMessage.includes('咖啡') || lowerMessage.includes('酒精') || lowerMessage.includes('不舒服')) {
        return '某些食物确实可能触发偏头痛，常见的包括巧克力、咖啡因、酒精、含有硝酸盐的食物等。如果你刚吃完巧克力后感到不舒服，建议：1. 休息在安静黑暗的房间；2. 多喝水帮助代谢；3. 记录这次发作，以便识别个人触发因素；4. 如果症状严重，可服用止痛药。';
    }
    if (lowerMessage.includes('触发因素') || lowerMessage.includes('原因') || lowerMessage.includes('为什么')) {
        return '偏头痛的常见触发因素包括：压力、睡眠不足或过多、饮食因素（如酒精、咖啡因、巧克力、硝酸盐等）、荷尔蒙变化、环境因素（如强光、噪音、天气变化）等。';
    }
    if (lowerMessage.includes('治疗') || lowerMessage.includes('缓解') || lowerMessage.includes('怎么办') || lowerMessage.includes('怎么治')) {
        return '偏头痛的治疗包括：休息在安静、黑暗的房间，服用止痛药（如布洛芬、对乙酰氨基酚），避免触发因素，保持规律的生活习惯，尝试放松技巧（如深呼吸、冥想），严重时可使用处方药。';
    }
    if (lowerMessage.includes('记录') || lowerMessage.includes('日记') || lowerMessage.includes('跟踪')) {
        return '记录偏头痛发作情况有助于识别触发因素和规律。建议记录发作时间、持续时间、疼痛程度、伴随症状、当天的饮食、睡眠、压力水平等信息。';
    }
    if (lowerMessage.includes('症状') || lowerMessage.includes('表现') || lowerMessage.includes('感觉')) {
        return '偏头痛的典型症状包括：单侧搏动性头痛、中重度疼痛、恶心呕吐、对光和声音敏感、有时伴有视觉先兆（如闪光、暗点）等。症状通常持续4-72小时。';
    }
    if (lowerMessage.includes('苹果') || lowerMessage.includes('水果')) {
        return '苹果通常被认为是健康食品，不是偏头痛的典型触发因素。建议观察自身反应，如果你有明确关联，可以继续记录；否则继续保持均衡饮食与规律作息。';
    }
    return '抱歉，我不太明白你的问题。我是一个专注于偏头痛相关问题的AI助手，你可以问我关于偏头痛的症状、触发因素、治疗方法等问题。如果你希望测试 DeepSeek 实际回答，请检查 API Key 是否已输入并保存，控制台看是否有网络请求。';
}

// 添加到聊天历史
function addToChatHistory(text, sender) {
    chatHistory.push({
        text: text,
        sender: sender,
        timestamp: new Date().toISOString()
    });
    if (chatHistory.length > 50) {
        chatHistory.shift();
    }
}
function saveChatHistory() {
    localStorage.setItem('aiChatHistory', JSON.stringify(chatHistory));
}

// 从本地存储加载历史
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

// 集成AI API的函数
async function callAIAPI(message) {
    // 运行时重新读本地 Key确保新保存的可用
    const localKey = localStorage.getItem('deepseekApiKey');
    if (localKey && localKey.trim()) {
        DEEPSEEK_API_KEY = localKey.trim();
    }

    // 如果没有配置key直接使用本地模拟
    if (!DEEPSEEK_API_KEY || DEEPSEEK_API_KEY === 'YOUR_DEEPSEEK_API_KEY') {
        console.warn('DeepSeek API Key未配置，使用本地模拟回复。');
        return generateMockAIResponse(message);
    }

    const systemPrompt = '你是一个专业的偏头痛健康助手，提供温和、实用并且符合健康安全的建议。';

    const chatMessagesPayload = [
        { role: 'system', content: systemPrompt },
        ...chatHistory.map(msg => ({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: msg.text
        })),
        { role: 'user', content: message }
    ];

    const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            messages: chatMessagesPayload,
            stream: false
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    if (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
        return data.choices[0].message.content.trim();
    }

    throw new Error('DeepSeek API返回无效数据');
}

// 初始化聊天
initChat();

// 导出函数
// function showChat() {
//     chatContainer.classList.add('visible');
//     setTimeout(() => chatInput.focus(), 300);
// }
