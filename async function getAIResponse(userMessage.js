async function getAIResponse(userMessage) {
    const typingEl = displayTypingIndicator();
    try {
        const aiResponse = await callAIAPI(userMessage);
        removeTypingIndicator(typingEl);
        displayMessage('[DeepSeek] ' + aiResponse, 'ai');
        addToChatHistory(aiResponse, 'ai');
        saveChatHistory();
    } catch (error) {
        console.error('AI回复失败，使用本地模拟：', error);
        removeTypingIndicator(typingEl);

        const fallback = generateMockAIResponse(userMessage);
        const fallbackResponse = fallback + '\n\n（回退本地模拟）';
        displayMessage('[本地] ' + fallbackResponse, 'ai');
        addToChatHistory(fallbackResponse, 'ai');
        saveChatHistory();
    }
}