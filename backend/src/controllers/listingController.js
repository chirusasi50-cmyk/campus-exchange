import mongoose from "mongoose";
import { z } from "zod";
import Listing from "../models/Listing.js";

const listingSchema = z.object({
  title: z.string().trim().min(2).max(100),
  category: z.enum(["Books", "Electronics", "Accessories", "Other"]),
  price: z.coerce.number().finite().min(0).max(10000000),
  condition: z.string().trim().min(1).max(40),
  description: z.string().trim().max(1500).optional().default(""),
  contact: z.string().trim().max(40).optional().default(""),
  emoji: z.string().trim().max(16).optional().default("📦"),
  block: z.enum(["A", "H", "N", "U", "P", "Unassigned"]).optional().default("Unassigned"),
  image: z.string().max(3000000).optional().default(""),
});

const validateListing = (body) => listingSchema.safeParse(body);

export const getListings = async (req, res) => {
  try {
    const filter = {};
    if (req.query.category) filter.category = req.query.category;
    if (req.query.block) filter.block = req.query.block;
    const listings = await Listing.find(filter)
      .populate("owner", "name")
      .sort({ createdAt: -1 });
    return res.status(200).json({ count: listings.length, listings });
  } catch (error) {
    console.error("Get listings error:", error.message);
    return res.status(500).json({ message: "Unable to fetch listings" });
  }
};

export const getMyListings = async (req, res) => {
  try {
    const listings = await Listing.find({ owner: req.user._id }).sort({ createdAt: -1 });
    return res.status(200).json({ count: listings.length, listings });
  } catch (error) {
    console.error("Get my listings error:", error.message);
    return res.status(500).json({ message: "Unable to fetch your listings" });
  }
};

export const getListingById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid listing ID" });
    }
    const listing = await Listing.findById(req.params.id).populate("owner", "name");
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    return res.status(200).json({ listing });
  } catch (error) {
    console.error("Get listing error:", error.message);
    return res.status(500).json({ message: "Unable to fetch listing" });
  }
};

export const createListing = async (req, res) => {
  const validation = validateListing(req.body);
  if (!validation.success) {
    return res.status(400).json({ message: "Invalid listing details", errors: validation.error.issues });
  }
  try {
    const listing = await Listing.create({
      ...validation.data,
      seller: req.user.name,
      owner: req.user._id,
    });
    return res.status(201).json({ message: "Listing created successfully", listing });
  } catch (error) {
    console.error("Create listing error:", error.message);
    return res.status(500).json({ message: "Unable to create listing" });
  }
};

const updateListing = async (req, res, isAdmin = false) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid listing ID" });
  }
  const validation = validateListing(req.body);
  if (!validation.success) {
    return res.status(400).json({ message: "Invalid listing details", errors: validation.error.issues });
  }
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    if (!isAdmin && listing.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You can only edit your own listings" });
    }
    Object.assign(listing, validation.data);
    await listing.save();
    return res.status(200).json({ message: "Listing updated successfully", listing });
  } catch (error) {
    console.error("Update listing error:", error.message);
    return res.status(500).json({ message: "Unable to update listing" });
  }
};

export const editListing = (req, res) => updateListing(req, res, false);
export const adminEditListing = (req, res) => updateListing(req, res, true);

const deleteListing = async (req, res, isAdmin = false) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid listing ID" });
  }
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    if (!isAdmin && listing.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You can only delete your own listings" });
    }
    await listing.deleteOne();
    return res.status(200).json({ message: "Listing deleted successfully" });
  } catch (error) {
    console.error("Delete listing error:", error.message);
    return res.status(500).json({ message: "Unable to delete listing" });
  }
};

export const removeListing = (req, res) => deleteListing(req, res, false);
export const adminRemoveListing = (req, res) => deleteListing(req, res, true);
