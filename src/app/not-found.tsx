import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page404">
      <script
        dangerouslySetInnerHTML={{
          __html: "document.body.classList.add('is-404')",
        }}
      />
      <h1 className="h-quiet">Page not found.</h1>
      <Link className="btn btn--red" href="/" style={{ marginTop: 18 }}>
        Go home
      </Link>
    </main>
  );
}
