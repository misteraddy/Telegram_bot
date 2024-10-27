const dotenv = require("dotenv");
const { Telegraf } = require("telegraf");
const userModel = require("./src/models/User");
const connectDB = require("./src/config/db");
const { message } = require("telegraf/filters");
const eventModel = require("./src/models/Event");
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);

const GEMINI_KEY = process.env.GEMINI_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_KEY);

const model = genAI.getGenerativeModel({ model: "gemini-pro" });

try {
  connectDB();
  console.log("DB connected successfully");
} catch (err) {
  console.error("Error connecting to DB:", err);
  process.kill(process.pid, "SIGTERM");
}

bot.start(async (ctx) => {
  const from = ctx.update.message.from;

  try {
    await userModel.findOneAndUpdate(
      { tgId: from.id },
      {
        $setOnInsert: {
          firstName: from.first_name,
          lastName: from.last_name,
          isBot: from.is_bot,
          username: from.username,
        },
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error("Error saving user data:", err);
    await ctx.reply("Facing difficulties in saving user data.");
  }

  await ctx.reply(
    `Hey! ${from.first_name}, Welcome. I will be writing highly engaging social media posts for you, just keep feeding me the events throughout the day. Let's shine on social media!`
  );
});

bot.command("generate", async (ctx) => {
  const from = ctx.update.message.from;

  // Send initial message
  const { message_id: waitingMessageId } = await ctx.reply(
    `Hey! ${from.first_name}, kindly wait for a moment. I am curating posts for you`
  );

  const { message_id: waitingStickerId } = await ctx.replyWithSticker(
    'CAACAgIAAxkBAANnZxZ37StcZYw22ktFWn4PoCTwBosAAhMAA8A2TxOqs4f3fzjKpTYE'
  );

  const startOfTheDay = new Date();
  startOfTheDay.setHours(0, 0, 0, 0);

  const endOfTheDay = new Date();
  endOfTheDay.setHours(23, 59, 59, 999);

  try {
    const events = await eventModel.find({
      tgId: from.id,
      createdAt: {
        $gte: startOfTheDay,
        $lte: endOfTheDay,
      },
    });

    if (events.length === 0) {
      await ctx.reply("No Events for the Day.");
      await ctx.deleteMessage(waitingMessageId);
      await ctx.deleteMessage(waitingStickerId);
      return;
    }

    const eventTexts = events.map((event) => event.text).join(", ");

    const query = `You are a social media assistant. Your task is to generate creative and engaging social media posts based on the provided event details. Write like a human, for humans. Craft three engaging social media posts tailored for LinkedIn, Facebook, and Twitter, using simple language. Use given time labels just to understand the order of the event, don't mention the time in the posts. Each post should creatively highlight the following events. Ensure the tone is conversational and impactful. Focus on engaging the respective platform's audience, encouraging interaction, and driving interest in the events: ${eventTexts}`;

    const result = await model.generateContent(query);

    await userModel.findOneAndUpdate(
      {
        tgId:from.id,
      },{
        $inc:{
          promptTokens:result.response.usageMetadata.promptTokenCount,
          completionTokens:result.response.usageMetadata.candidatesTokenCount,
        }
      })

    await ctx.deleteMessage(waitingMessageId);
    await ctx.deleteMessage(waitingStickerId);

    await ctx.reply(result.response.candidates[0].content.parts[0].text);
  } catch (err) {
    console.error("Error generating post:", err);
    await ctx.reply("There was an error generating the post.");
  }
});

// bot.on(message("sticker"), async (ctx) => {
//   const stickerId = ctx.update.message.sticker.file_id;
//   console.log(stickerId);
// });

bot.on(message("text"), async (ctx) => {
  const from = ctx.update.message.from;
  const userMessage = ctx.update.message.text;

  try {
    await eventModel.create({
      text: userMessage,
      tgId: from.id,
    });

    await ctx.reply("Got the message. I'll save it for later!");
  } catch (err) {
    console.error("Error saving message:", err);
    await ctx.reply("Sorry, I encountered an error saving your message.");
  }
});

bot.launch();

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));