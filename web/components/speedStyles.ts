// Colours for the 0× / 1× / 2× speed buttons: blue = clock stopped,
// black = normal, orange = draining fast. The chosen speed is filled in; the
// others show their colour as a bar along the top.
const SPEED_STYLES: Record<number, { on: string; off: string }> = {
  0: { on: "border-blue-600 bg-blue-600 text-white", off: "border-t-blue-600 text-blue-700" },
  1: { on: "border-gray-900 bg-gray-900 text-white", off: "border-t-gray-900 text-gray-900" },
  2: { on: "border-orange-600 bg-orange-600 text-white", off: "border-t-orange-600 text-orange-700" },
};

export function speedButtonClass(speed: number, selected: boolean) {
  const style = SPEED_STYLES[speed] ?? SPEED_STYLES[1];
  return `border-2 font-bold ${selected ? style.on : `border-t-4 border-gray-300 bg-white ${style.off}`}`;
}
