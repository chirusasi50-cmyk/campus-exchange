import mongoose from "mongoose";

const listingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    category: {
      type: String,
      required: true,
      enum: ["Books", "Electronics", "Accessories", "Other"],
    },
    price: { type: Number, required: true, min: 0, max: 10000000 },
    condition: { type: String, required: true, trim: true, maxlength: 40 },
    description: { type: String, trim: true, maxlength: 1500, default: "" },
    contact: { type: String, trim: true, maxlength: 40, default: "" },
    emoji: { type: String, trim: true, maxlength: 16, default: "📦" },
    block: {
      type: String,
      enum: ["A", "H", "N", "U", "P", "Unassigned"],
      default: "Unassigned",
    },
    image: { type: String, default: "", maxlength: 3000000 },
    seller: { type: String, trim: true, maxlength: 60 },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

listingSchema.index({ createdAt: -1 });
listingSchema.index({ category: 1, block: 1 });

const Listing = mongoose.model("Listing", listingSchema);
export default Listing;
