import { splitPlate } from "@/lib/phone";

// Российский госномер как табличка. size: sm (канбан) / md (карточки) / lg (экран охраны)
export default function Plate({ plate, size = "md", className = "" }: { plate?: string | null; size?: "sm" | "md" | "lg"; className?: string }) {
  if (!plate) {
    return (
      <span className={`inline-flex items-center rounded border border-dashed border-steel/50 px-2 font-mono text-xs text-ink-muted ${size === "lg" ? "h-10" : "h-6"} ${className}`}>
        без номера
      </span>
    );
  }
  const { left, region } = splitPlate(plate);
  const s = {
    sm: { h: "h-6", txt: "text-[13px]", reg: "text-[9px]", px: "px-1.5", gap: "gap-1" },
    md: { h: "h-8", txt: "text-[17px]", reg: "text-[11px]", px: "px-2", gap: "gap-1.5" },
    lg: { h: "h-12", txt: "text-[28px]", reg: "text-[14px]", px: "px-3", gap: "gap-2" },
  }[size];
  return (
    <span
      className={`inline-flex ${s.h} items-stretch overflow-hidden rounded-[4px] border-[1.5px] border-ink bg-white font-mono font-bold tracking-[0.08em] text-ink shadow-[inset_0_0_0_1px_#fff,0_1px_0_rgba(0,0,0,.25)] ${className}`}
      title={plate}
    >
      <span className={`flex items-center ${s.px} ${s.txt} leading-none`}>{left}</span>
      {region && (
        <span className={`flex flex-col items-center justify-center border-l-[1.5px] border-ink ${s.px} leading-none`}>
          <span className={`${s.reg} font-bold`}>{region}</span>
          <span className="mt-0.5 flex items-center gap-[2px]">
            <span className="flex h-[5px] w-[9px] flex-col overflow-hidden rounded-[1px]">
              <span className="flex-1 bg-white" />
              <span className="flex-1 bg-[#1e4fa3]" />
              <span className="flex-1 bg-[#d52b1e]" />
            </span>
            <span className="text-[6px] font-bold leading-none">RUS</span>
          </span>
        </span>
      )}
    </span>
  );
}
