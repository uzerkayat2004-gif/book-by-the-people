import { redirect } from "next/navigation";

/** Old address: every open book now lives on /books, released ones in the Library. */
export default function ExplorePage() {
  redirect("/books");
}
