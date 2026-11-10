import mongoose from “mongoose”;

const conversationSchema = new mongoose.Schema(
{
listing: {
type: mongoose.Schema.Types.ObjectId,
ref: “Listing”,
required: true,
},

buyer: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "User",
  required: true,
},
seller: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "User",
  required: true,
},
lastMessage: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "Message",
  default: null,
},
lastMessageAt: {
  type: Date,
  default: Date.now,
},

},
{ timestamps: true }
);

// Prevent duplicate conversations for the same buyer and listing.
conversationSchema.index(
{ listing: 1, buyer: 1, seller: 1 },
{ unique: true }
);

const Conversation = mongoose.model(
“Conversation”,
conversationSchema
);

export default Conversation;
