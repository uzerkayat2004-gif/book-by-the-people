import { redirect } from "next/navigation";

// Old countdown link from the first launch. Send anyone who still has it to the books.
export default function OldBookLink() {
  redirect("/books");
}
