import mongoose, { Document, Schema } from "mongoose";

export interface IContact extends Document {
  phoneNumber: number;
  whatsappNumber: string;
  whatsappLink: string;
  emailAddress: string;
}

const ContactSchema = new Schema<IContact>({
  phoneNumber: {
    type: Number,
  },
  whatsappNumber: {
    type: String,
  },
  whatsappLink: {
    type: String,
  },
  emailAddress: {
    type: String,
  },
});

export const Contact = mongoose.model<IContact>("contact", ContactSchema);


