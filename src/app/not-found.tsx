import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page" data-nofoot="">
      <script
        dangerouslySetInnerHTML={{
          __html: "document.body.classList.add('is-404')",
        }}
      />
      <div className="narrow done">
        <h1>Page not found.</h1>
        <Link className="btn btn--red btn--big" href="/" style={{ marginTop: 18, display: "inline-block" }}>
          Go home
        </Link>
      </div>
    </main>
  );
}
