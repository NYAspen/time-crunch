import { logout } from "@/app/actions";

// Red, sign-style log out button for the team and admin page headers.
export function LogoutButton() {
  return (
    <form action={logout}>
      <button className="flex shrink-0 items-center gap-1.5 bg-red-600 whitespace-nowrap px-3 py-2 text-xs font-bold tracking-wider text-white uppercase">
        <span aria-hidden>←</span> Log out
      </button>
    </form>
  );
}
