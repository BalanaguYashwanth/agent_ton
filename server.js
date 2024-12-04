require('dotenv').config()
const { TonClient, WalletContractV4 } = require('ton');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const cron = require('node-cron');
const Together  = require('together-ai')
const axios = require('axios')
const app = express();
app.use(bodyParser.json());


const bot = new TelegramBot(BOT_TOKEN, { polling: true });
let TX_PROCESS = false
let AMOUNT = 0;
let TX_CHATID = ''
let messages = [];
let groupChatIds = [];

const tonClient = new TonClient({
    endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC'
  });

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const message = "Each group costs 1 TON to summarize. To start enter '/pay1' for 1 group";
    await registerUser(chatId)
    bot.sendMessage(chatId, message);
});

bot.onText(/\/echo(.+)/, async (msg, match) => {
    let chatId = msg.chat.id;
    let resp = match[1];
    bot.sendMessage(chatId, resp);
});

bot.onText(/\/pay(.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    TX_CHATID = chatId
    let resp = match[1];
    console.log(resp)
    const amount = resp * 1e9;
    AMOUNT  = resp
    const paymentUrl = `https://tonhub.com/transfer/${walletAddress}?amount=${amount}`;
    bot.sendMessage(chatId, "Click to pay for agent:", {
      reply_markup: {
        inline_keyboard: [[{ text: 'Pay with TON', url: paymentUrl }]]
      }
    });
    TX_PROCESS = true
  });

const registerUser = async (id) => {
    await axios.put(`${API_URL}/${id}.json`, {'source':'telegram'});
}

const updateCredits = async (id, AMOUNT) => {
    console.log('AMOUNT---->', AMOUNT)
    await axios.patch(`${API_URL}/${id}.json`, {
        credits: AMOUNT * 10
    });
}

setInterval(async () => {
    if(TX_PROCESS){
        bot.sendMessage(TX_CHATID, `Payment received! You can now add me to your group. URL - https://t.me/${BOT_NAME}?startgroup=true`);
        await updateCredits(TX_CHATID, AMOUNT)
        TX_PROCESS = false
    }
}, 60000);

const updateMessages = async (id, obj) => {
    // console.log('ur;---->', `${API_URL}/${id}.json`)
    const jsonData = await axios.get(`${API_URL}/${TX_CHATID}.json`)
    const arr = jsonData?.data?.messages || []
    arr.push(obj)
    await axios.patch(`${API_URL}/${id}.json`, {
        messages: arr
    });
}

bot.on('message', async (msg) => {
    console.log('msg.chat.id--->',TX_CHATID)
    // Check if the message is from a group
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        if (!groupChatIds.includes(msg.chat.id)) {
            groupChatIds.push(msg.chat.id);
            console.log(`New group added: ${msg.chat.id}`);
        }

        messages.push({ chatId: msg.chat.id, text: msg.text });
        await updateMessages(TX_CHATID, { chatId: msg.chat.id, text: msg.text })
    }
});

const summariseAI = async (messagesText) => {
    try{
        const completion = await together.chat.completions.create({
            model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
            messages:[{"role": "user", "content": messagesText}],
        })
        return (completion?.choices[0]?.message?.content)
    } catch(error){
        console.log('error', error)
    }
}

const getMessages = async (TX_CHATID) => {
    if(TX_CHATID){
        const jsonData = await axios.get(`${API_URL}/${TX_CHATID}.json`)
        const arr = jsonData?.data?.messages || []
        return arr
    }
    return []
  
}

// Schedule a cron job to run at midnight every day
cron.schedule('*/10 * * * * *', async () => {
    try {
            // todo - iternate through all id's and get messages and minus credits
            const TX_CHATID = '592085641'
            const groupMessages = await getMessages(TX_CHATID)
            if (groupMessages.length >= 2) {
                const messagesText = groupMessages.map(msg => msg.text).join(' ');
                const templateMessages = `Summarise the content in very very short: ${messagesText}`
                const summary = await summariseAI(templateMessages);
                // const summary = 'hello222'
                await bot.sendMessage(TX_CHATID, `Summary:\n${summary}`, { parse_mode: 'HTML' });
                messages = messages.filter(msg => msg.chatId !== chatId);
            }
    } catch (error) {
        console.error("Error in daily cron job:", error);
    }
});
