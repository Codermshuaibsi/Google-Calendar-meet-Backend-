const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const mongoose = require("mongoose");
const { google } = require("googleapis");
const User = require("./Model/UserModel");


dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log("DB Error:", err));

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// Google OAuth2 setup
app.get("/google", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      'https://www.googleapis.com/auth/calendar'
    ],
    email: req.query.email || "",
  });
  res.redirect(url);
});

// Redirect endpoint for Google OAuth2
app.get("/google/redirect", async (req, res) => {
  const code = req.query.code;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();
    const email = data.email;

    await User.findOneAndUpdate(
      { email },
      { ...tokens, email },
      { upsert: true, new: true }
    );

    res.redirect(`http://localhost:3000/dashboard?email=${email}`);
  } catch (error) {
    console.error("OAuth Error:", error.response?.data || error.message);
    res.status(500).send("OAuth failed");
  }
});

// Endpoint to fetch calendar events
app.get("/calendar/events", async (req, res) => {
  const email = req.headers.email;
  if (!email) return res.status(400).send("Email required");

  const user = await User.findOne({ email });
  if (!user) return res.status(404).send("User not found");

  oauth2Client.setCredentials({
    access_token: user.access_token,
    refresh_token: user.refresh_token,
    scope: user.scope,
    token_type: user.token_type,
    expiry_date: user.expiry_date,
  });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  try {
    const { data } = await calendar.events.list({
      calendarId: "primary",
      maxResults: 10,
      singleEvents: true,
      orderBy: "startTime",
    });
    res.json(data.items);
  } catch (err) {
    console.error("Calendar Error:", err.message);
    res.status(500).send("Failed to fetch events");
  }
});

// Endpoint to create a new calendar event with Google Meet link
app.post("/create/event", async (req, res) => {
  const { email, event } = req.body;
  if (!email || !event) return res.status(400).send("Missing data");

  const user = await User.findOne({ email });
  if (!user) return res.status(404).send("User not found");

  oauth2Client.setCredentials({
    access_token: user.access_token,
    refresh_token: user.refresh_token,
    scope: user.scope,
    token_type: user.token_type,
    expiry_date: user.expiry_date,
  });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  try {
    // Add Google Meet creation to your event request
    const response = await calendar.events.insert({
      calendarId: "primary",
      resource: {
        ...event,
        conferenceData: {
          createRequest: {
            requestId: Math.random().toString(36).substring(2), // unique identifier
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
      conferenceDataVersion: 1, // set this for conference support
    });


    res.send({ success: true, data: response.data });
  } catch (err) {
    console.error("Event Creation Error:", err.message);
    res.status(500).send(err);
  }
});


// Endpoint to delete a calendar event
app.delete("/delete/event/:id", async (req, res) => {
  const email = req.headers.email;
  const eventId = req.params.id;
  if (!email || !eventId) return res.status(400).send("Missing data");

  const user = await User.findOne({ email });
  if (!user) return res.status(404).send("User not found");
  oauth2Client.setCredentials({
    access_token: user.access_token,
    refresh_token: user.refresh_token,
    scope: user.scope,
    token_type: user.token_type,
    expiry_date: user.expiry_date,
  });
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  try {
    await calendar.events.delete({
      calendarId: "primary",
      eventId,
    });
    res.send({ success: true });
  } catch (err) {
    console.error("Event Deletion Error:", err.message);
    res.status(500).send("Failed to delete event");
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
