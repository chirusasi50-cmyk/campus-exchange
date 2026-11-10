import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema({
  listing: { type: mongoose.Schema.Types.ObjectId, ref: "Listing", required: true },
  // participants/participantKey are used by the current chat API. buyer/seller
  // retain compatibility with conversations created by the earlier API.
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  participantKey: { type: String },
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
  lastMessageAt: { type: Date, default: Date.now },
}, { timestamps: true });

conversationSchema.pre("validate", function fillParticipantAliases() {
  if (!this.participants?.length && this.buyer && this.seller) {
    this.participants = [this.buyer, this.seller];
  }
  if (this.participants?.length === 2) {
    this.buyer ||= this.participants[0];
    this.seller ||= this.participants[1];
    this.participantKey ||= this.participants.map(String).sort().join(":");
  }
});

conversationSchema.index({ listing: 1, participantKey: 1 }, { unique: true });

export default mongoose.model("Conversation", conversationSchema);
