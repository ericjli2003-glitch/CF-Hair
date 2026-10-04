/** Square "CF" mark, used in the owner admin header. */
export function Monogram({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-grid place-items-center rounded-md bg-black font-cond text-[1.05rem] font-semibold leading-none text-white ${className}`}
    >
      CF
    </span>
  );
}

/** The salon's name set as its sign: one line, no tagline. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`font-cond text-[1.6rem] font-semibold leading-none tracking-[-0.005em] text-black ${className}`}>
      CF Hair Salon
    </span>
  );
}
