const express = require('express');
const router = express.Router();
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const Complaint = require('../models/Complaint');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { classifyComplaint } = require('../services/geminiAI');
const { notifyComplaintSubmitted } = require('../services/notificationService');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'complaint-system',
    allowed_formats: ['jpeg', 'jpg', 'png', 'gif', 'webp']
  }
});

const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/', auth, upload.array('photos', 5), async (req, res) => {
  try {
    const { title, description, category, address, ward, lat, lng } = req.body;
    const photos = req.files ? req.files.map(f => f.path) : [];
    const aiResult = await classifyComplaint(title, description, category);
    const complaint = new Complaint({
      user: req.user._id,
      title, description, category,
      location: { address, ward, coordinates: { lat: lat || null, lng: lng || null } },
      photos,
      priority: aiResult.priority,
      aiClassification: aiResult
    });
    await complaint.save();
    notifyComplaintSubmitted(req.user, complaint).catch(err =>
      console.error('Notification error:', err.message)
    );
    res.status(201).json({ message: 'Complaint submitted successfully!', complaint });
  } catch (err) {
    res.status(500).json({ message: 'Error submitting complaint', error: err.message });
  }
});

router.get('/my', auth, async (req, res) => {
  try {
    const complaints = await Complaint.find({ user: req.user._id })
      .populate('assignedWorker', 'name email phone')
      .sort({ createdAt: -1 });
    res.json(complaints);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id)
      .populate('user', 'name email phone')
      .populate('assignedWorker', 'name email phone');
    if (!complaint) return res.status(404).json({ message: 'Complaint not found.' });
    res.json(complaint);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.post('/:id/rate', auth, async (req, res) => {
  try {
    const { rating, feedback } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
    }
    const complaint = await Complaint.findOne({ _id: req.params.id, user: req.user._id });
    if (!complaint) return res.status(404).json({ message: 'Complaint not found.' });
    if (complaint.status !== 'resolved') {
      return res.status(400).json({ message: 'Only resolved complaints can be rated.' });
    }
    complaint.rating = rating;
    complaint.feedback = feedback || '';
    await complaint.save();
    res.json({ message: 'Rating submitted successfully! Thank you!' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;