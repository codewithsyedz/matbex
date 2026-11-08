import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Minus } from "lucide-react";
import { useRevealInView } from "@/hooks/useRevealInView";
import { useComparisonContent, ComparisonCellValue } from "@/hooks/useComparisonContent";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";

const renderCell = (value: ComparisonCellValue | undefined, isHighlighted: boolean) => {
  if (value === undefined || value === null) {
    return <Minus className="w-4 h-4 mx-auto text-gray-400" />;
  }
  if (value === "addon") {
    return <span className="text-[11px] uppercase tracking-wider text-[#D9A441] font-medium">Add-on</span>;
  }
  if (typeof value === "string") {
    return (
      <span
        className={`text-sm font-medium ${
          isHighlighted ? "text-[#00713A]" : "text-gray-700"
        }`}
      >
        {value}
      </span>
    );
  }
  if (value === true) {
    return <Check className={`w-4 h-4 mx-auto ${isHighlighted ? "text-[#00A859]" : "text-gray-400"}`} />;
  }
  return <Minus className="w-4 h-4 mx-auto text-gray-400" />;
};

export const MarketComparison = () => {
  const { ref, isRevealed } = useRevealInView<HTMLDivElement>({ margin: "-100px" });
  const { settings, columns, rows, isLoading } = useComparisonContent();
  const [showAllRows, setShowAllRows] = useState(false);
  const { i18n } = useTranslation();
  const isAr = i18n.language?.startsWith("ar");

  if (isLoading) {
    return (
      <div className="mt-24">
        <Skeleton className="h-8 w-64 mx-auto mb-6" />
        <Skeleton className="h-[400px] w-full rounded-lg" />
      </div>
    );
  }

  if (!settings || !settings.is_active || columns.length === 0 || rows.length === 0) {
    return null;
  }

  const activeColumns = columns.filter((c) => c.is_active);
  const activeRows = rows.filter((r) => r.is_active);
  const totalCols = activeColumns.length;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: 0.8 }}
      className="mt-24"
    >
      <div className="text-center mb-10">
        <p className="text-xs font-medium text-[#00713A] uppercase tracking-[0.08em] mb-4">
          {(isAr && settings.eyebrow_ar) || settings.eyebrow}
        </p>
        <h3 className="text-2xl md:text-3xl font-semibold tracking-[-0.01em] text-gray-900 mb-3 leading-[1.15]">
          {(isAr && settings.headline_prefix_ar) || settings.headline_prefix}{" "}
          <span className="text-gray-500">
            {(isAr && settings.headline_bold_ar) || settings.headline_bold}
          </span>
        </h3>
        <p className="text-sm text-gray-600 max-w-2xl mx-auto leading-[1.6]">
          {(isAr && settings.subtitle_ar) || settings.subtitle}
        </p>
      </div>

      {/* Mobile: stacked cards so every value is readable without sideways scrolling */}
      <div className="grid gap-3 md:hidden">
        {(showAllRows ? activeRows : activeRows.slice(0, 4)).map((row) => (
          <div
            key={row.id}
            className="rounded-xl border border-gray-200 bg-white p-3"
          >
            <p className="text-[13px] font-medium text-gray-900 leading-[1.35]">
              {(isAr && row.label_ar) || row.label}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-1.5">
              {activeColumns.map((col) => (
                <div
                  key={col.id}
                  className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 ${
                    col.is_highlighted
                      ? "bg-[#00A859]/[0.08] ring-1 ring-[#00A859]/25"
                      : "bg-gray-50"
                  }`}
                >
                  <dt
                    className={`text-[11px] truncate ${
                      col.is_highlighted
                        ? "font-semibold text-[#00713A]"
                        : "text-gray-600"
                    }`}
                  >
                    {(isAr && col.name_ar) || col.name}
                  </dt>
                  <dd className="shrink-0 text-right text-[11px]">
                    {renderCell(row.cells?.[col.column_key], col.is_highlighted)}
                  </dd>
                </div>
              ))}
            </dl>

          </div>
        ))}
        {activeRows.length > 4 && (
          <button
            type="button"
            onClick={() => setShowAllRows((v) => !v)}
            className="min-h-11 rounded-lg border border-gray-200 bg-white/[0.04] px-4 text-sm font-medium text-[#00713A]"
          >
            {showAllRows
              ? "Show less"
              : `Show ${activeRows.length - 4} more comparisons`}
          </button>
        )}
      </div>


      <div className="relative hidden md:block">

        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table
            className="w-full min-w-[720px] border-separate border-spacing-0"
            style={{ minWidth: Math.max(720, 220 + totalCols * 140) }}
          >
            <caption className="sr-only">
              {(isAr && settings.subtitle_ar) || settings.subtitle}
            </caption>
            <thead>
              <tr className="bg-white/[0.04]">
                <th
                  scope="col"
                  className="sticky left-0 z-10 bg-white text-left text-xs font-medium text-gray-500 uppercase tracking-[0.06em] px-6 py-4 w-[36%] border-b border-gray-200"
                >
                  Capability
                </th>
                {activeColumns.map((col) => (
                  <th
                    key={col.id}
                    scope="col"
                    className={`text-center px-4 py-4 border-b border-gray-200 ${
                      col.is_highlighted
                        ? "bg-[#00A859]/[0.06] border-x border-x-[#00A859]/25"
                        : ""
                    }`}
                  >
                    <div
                      className={`text-sm font-semibold ${
                        col.is_highlighted ? "text-[#00713A]" : "text-gray-700"
                      }`}
                    >
                      {(isAr && col.name_ar) || col.name}
                    </div>
                    {(col.sublabel || col.sublabel_ar) && (
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        {(isAr && col.sublabel_ar) || col.sublabel}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeRows.map((row, i) => {
                const isLast = i === activeRows.length - 1;
                return (
                  <tr
                    key={row.id}
                    className={`group ${row.is_footer ? "bg-white/[0.03] font-medium" : ""}`}
                  >
                    <th
                      scope="row"
                      className={`sticky left-0 z-10 bg-white text-left font-normal text-sm text-gray-700 px-6 py-3.5 leading-[1.45] transition-colors group-hover:text-gray-900 ${
                        !isLast ? "border-b border-gray-100" : ""
                      }`}
                    >
                      {(isAr && row.label_ar) || row.label}
                    </th>
                    {activeColumns.map((col) => (
                      <td
                        key={col.id}
                        className={`text-center px-4 py-3.5 ${
                          !isLast ? "border-b border-gray-100" : ""
                        } ${
                          col.is_highlighted
                            ? "bg-[#00A859]/[0.06] border-x border-x-[#00A859]/25"
                            : ""
                        }`}
                      >
                        {renderCell(row.cells?.[col.column_key], col.is_highlighted)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>


      {(settings.footnote || settings.footnote_ar) && (
        <p className="text-[11px] text-gray-400 text-center mt-4 max-w-3xl mx-auto leading-[1.5]">
          {(isAr && settings.footnote_ar) || settings.footnote}
        </p>
      )}
    </motion.div>
  );
};