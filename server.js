require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Configure Cloudinary using your .env keys
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// 2. Connect to MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Atlas Connected Successfully'))
  .catch(err => console.error('MongoDB connection error:', err));

// 3. Define the Database Schema
const EventSchema = new mongoose.Schema({
  imageUrl: String,
  timestamp: { type: Date, default: Date.now },
  type: { type: String, default: 'Motion Detected' }
});
const SecurityEvent = mongoose.model('SecurityEvent', EventSchema);

// 4. Configure Multer to hold the incoming ESP32 image in memory
const upload = multer({ storage: multer.memoryStorage() });

// 5. POST Route: Hardware sends image here
app.post('/api/upload', upload.single('imageFile'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('No image provided');

    // Convert image to base64 and upload to Cloudinary
    const b64 = Buffer.from(req.file.buffer).toString('base64');
    const dataURI = "data:" + req.file.mimetype + ";base64," + b64;
    const cloudRes = await cloudinary.uploader.upload(dataURI, { folder: 'street_monitor' });

    // Save the image URL and time to MongoDB Atlas
    const newEvent = new SecurityEvent({ imageUrl: cloudRes.secure_url });
    await newEvent.save();

    res.status(200).json({ success: true, event: newEvent });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// 6. GET Route: React Dashboard asks for the image history here
app.get('/api/events', async (req, res) => {
  try {
    const events = await SecurityEvent.find().sort({ timestamp: -1 }).limit(50);
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// 7. Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
