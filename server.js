import { App, ExpressReceiver } from '@slack/bolt';
import dotenv from 'dotenv';
import fs from 'fs';
import cron from 'node-cron';
import express from 'express';

dotenv.config();


const receiver = new ExpressReceiver({ signingSecret: process.env.SLACK_SIGNING_SECRET });
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

const dataFile = "./data.json";

function loadUsers() {
  return JSON.parse(fs.readFileSync(dataFile));
}

function saveUsers(users) {
  fs.writeFileSync(dataFile, JSON.stringify(users, null, 2));
}

function pickNextChampion() {
  let users = loadUsers();
  const available = users.filter(u => u.available);
  const lastIndex = available.findIndex(u => u.lastPicked);
  const nextIndex = (lastIndex + 1) % available.length;
  const next = available[nextIndex];

  users = users.map(u => ({
    ...u,
    lastPicked: u.name === next.name,
  }));

  saveUsers(users);
  return next;
}

async function postChampionMessage() {
  const champion = pickNextChampion();

  const result = await app.client.chat.postMessage({
    channel: process.env.CHANNEL_ID,
    text: `🚀 Time to deploy changes! ${champion.slackHandle}, you're up today.`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🚀 Time to deploy changes! ${champion.slackHandle}, you're up today.`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "🎲 Pick someone else",
            },
            action_id: "reroll_champion",
            value: champion.name,
          },
        ],
      },
    ],
  });

  // Store the timestamp and channel so we can update it later
  latestMessage.ts = result.ts;
  latestMessage.channel = result.channel;
}

const latestMessage = { ts: null, channel: null };

app.action("reroll_champion", async ({ ack, body, client }) => {
  await ack();

  const previous = body.actions[0].value;
  const users = loadUsers().filter(u => u.name !== previous && u.available);
  const current = users.find(u => !u.lastPicked) || users[0];

  let all = loadUsers().map(u => ({
    ...u,
    lastPicked: u.name === current.name,
  }));
  saveUsers(all);

  await client.chat.update({
    channel: latestMessage.channel,
    ts: latestMessage.ts,
    text: `🎲 New deploy champion: ${current.slackHandle}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🎲 New deploy champion: ${current.slackHandle}`,
        },
      },
    ],
  });
});

app.command("/rerollchampion", async ({ ack, respond }) => {
  await ack(); // <-- respond to Slack *instantly* to avoid timeout

  const next = pickNextChampion();

  await respond({
    response_type: "in_channel",
    text: `🔁 Manual reroll: ${next.slackHandle} is now today's deploy champion.`,
  });
});

cron.schedule("0 9 * * 2,4", () => {
  postChampionMessage();
});

const expressApp = express();
expressApp.use('/slack/events', receiver.router);

const PORT = process.env.PORT || 3000;
expressApp.listen(PORT, () => {
  console.log(`⚡️ Deploy Champion app is running on port ${PORT}`);
});