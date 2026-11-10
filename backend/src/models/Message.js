import mongoose from "mongoose";

const attachmentSchema = new mongoose.Schema({
  filename: { type: String, required: true, maxlength: 255 },
  url: { type: String, required: true, maxlength: 500 },
  mimeType: { type: String, enum: ["image/jpeg", "image/png", "image/webp", "application/pdf"], required: true },
  size: { type: Number, required: true, min: 1, max: 10 * 1024 * 1024 },
  publicId: { type: String, required: true, select: false },
  format: { type: String, required: true },
  resourceType: { type: String, enum: ["image", "raw"], required: true },
}, { _id: true });

const reactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  emoji: { type: String, required: true, maxlength: 8 },
}, { _id: false });

const messageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, trim: true, maxlength: 4000, default: "", required() { return !this.attachment && !this.content; } },
  // content/edited/isDeleted support records and clients from the original chat API.
  content: { type: String, trim: true, maxlength: 4000, default: "" },
  edited: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
  attachment: { type: attachmentSchema, default: null },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
  reactions: { type: [reactionSchema], default: [] },
  forwardedFrom: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null, select: false },
  isForwarded: { type: Boolean, default: false },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  deliveredAt: { type: Date, default: null },
  readAt: { type: Date, default: null },
  editedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

messageSchema.pre("validate", function syncLegacyFields() {
  if (!this.text && this.content) this.text = this.content;
  if (!this.content && this.text) this.content = this.text;
  if (this.editedAt) this.edited = true;
  if (this.deletedAt) this.isDeleted = true;
  if (this.isDeleted && !this.deletedAt) this.deletedAt = this.updatedAt || new Date();
  if (this.isDeleted) {
    this.text = "This message was deleted";
    this.content = this.text;
    this.edited = false;
  }
});

messageSchema.index({ conversation: 1, createdAt: 1 });

export default mongoose.model("Message", messageSchema);
