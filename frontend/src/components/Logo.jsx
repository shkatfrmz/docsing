export default function Logo({ size = 32, withWordmark = true }) {
  return (
    <>
      <svg
        className="brand-logo"
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
      >
        <rect width="64" height="64" rx="16" fill="#0a0a0a" />
        <rect x="14" y="10" width="30" height="40" rx="4" fill="#fffaf0" />
        <rect x="20" y="18" width="18" height="2.5" rx="1.25" fill="#e5e5e5" />
        <rect x="20" y="24" width="14" height="2.5" rx="1.25" fill="#e5e5e5" />
        <path
          d="M18 42c6-9 12-4 16-10 2 7 8 8 14 6"
          stroke="#ff4d8b"
          strokeWidth="3.2"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="46" cy="46" r="10" fill="#ffb084" />
        <path
          d="M42 46.5l3 3 6-7"
          stroke="#0a0a0a"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {withWordmark && <span className="brand-word">DocySign</span>}
    </>
  );
}
