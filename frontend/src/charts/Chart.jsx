/* Chart.jsx — six chart types drawn as plain SVG.

   No charting library. The shapes here are simple enough that a dependency
   would cost more in bundle size and API surface than it saves, and this way
   the visual language matches the rest of the page exactly. */

import React from "react";
import { PALETTE } from "../model.js";

const short = (v) => {
  const a = Math.abs(v);

  if (a >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (a >= 1000) return `${(v / 1000).toFixed(0)}k`;

  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

export default function Chart({ data, cfg = {} }) {
  const W = 700;
  const H = cfg.height || 220;

  const pal = PALETTE
    .slice(cfg.palette || 0)
    .concat(PALETTE);

  if (!data || !data.length) return null;

  const values = data.map((d) => Number(d.value) || 0);

  const max = Math.max(...values, 0) || 1;
  const min = Math.min(...values, 0);

  /* ============================================================
     PIE / DONUT
     ============================================================ */

  if (cfg.type === "pie" || cfg.type === "donut") {
    const total =
      values.reduce((a, b) => a + Math.abs(b), 0) || 1;

    const cx = W / 2;
    const cy = H / 2;

    const R = Math.min(W, H) / 2 - 14;

    const r0 =
      cfg.type === "donut"
        ? R * 0.58
        : 0;

    let a0 = -Math.PI / 2;

    const slices = data.map((d, i) => {
  const value = Math.abs(values[i]);

  if (value <= 0) return null;

  const ratio = value / total;

  /*
   * A 100% slice cannot be drawn correctly using an SVG arc
   * because start angle and end angle become identical.
   * Draw a real circle/ring instead.
   */
  if (ratio >= 0.999999) {
    if (cfg.type === "donut") {
      const ringR = (R + r0) / 2;
      const ringWidth = R - r0;

      return (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={ringR}
          fill="none"
          stroke={pal[i % pal.length]}
          strokeWidth={ringWidth}
        />
      );
    }

    return (
      <circle
        key={i}
        cx={cx}
        cy={cy}
        r={R}
        fill={pal[i % pal.length]}
      />
    );
  }

  const a1 =
    a0 +
    ratio *
      Math.PI *
      2;

  const big =
    a1 - a0 > Math.PI ? 1 : 0;

  const p = (rr, a) => [
    cx + rr * Math.cos(a),
    cy + rr * Math.sin(a),
  ];

  const [x1, y1] = p(R, a0);
  const [x2, y2] = p(R, a1);

  const [x3, y3] = p(r0, a1);
  const [x4, y4] = p(r0, a0);

  const dd =
    `M${x1} ${y1}` +
    `A${R} ${R} 0 ${big} 1 ${x2} ${y2}` +
    (
      r0
        ? `L${x3} ${y3}` +
          `A${r0} ${r0} 0 ${big} 0 ${x4} ${y4}`
        : `L${cx} ${cy}`
    ) +
    "Z";

  a0 = a1;

  return (
    <path
      key={i}
      d={dd}
      fill={pal[i % pal.length]}
      stroke="#fff"
      strokeWidth="1.5"
    />
  );
});

    /* ------------------------------------------------------------
       DATA-DRIVEN DONUT CENTER

       By default the first data item is treated as the main value.

       Example:

       [
         { label: "We have", value: 812 },
         { label: "Missing", value: 12 }
       ]

       => 812 / (812 + 12) = 98.54%
       ------------------------------------------------------------ */

    const mainIndex =
      Number.isInteger(cfg.mainIndex)
        ? cfg.mainIndex
        : 0;

    const mainValue =
      Math.abs(values[mainIndex] || 0);

    const percentage =
      cfg.source === "value_boxes"
        ? mainValue
        : total > 0
        ? (mainValue / total) * 100
        : 0;

    const percentageText =
      `${percentage.toFixed(
        percentage >= 99.95
          ? 0
          : percentage >= 10
            ? 0
            : 1
      )}%`;

    const mainLabel =
      data[mainIndex]?.label ||
      "Result";

    return (
      <svg
        className="chart-wrap"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
      >
        {slices}

        {cfg.type === "donut" && (
          <>
            {/* Main percentage */}
            <text
              x={cx}
              y={cy - 2}
              textAnchor="middle"
              fontSize="22"
              fontWeight="700"
              fill="#1A2326"
            >
              {percentageText}
            </text>

            {/* Main category */}
            <text
              x={cx}
              y={cy + 16}
              textAnchor="middle"
              fontSize="10"
              fill="#6B7A78"
            >
              {String(mainLabel).length > 16
                ? `${String(mainLabel).slice(0, 15)}…`
                : mainLabel}
            </text>
          </>
        )}
      </svg>
    );
  }
  /* ---- single stacked horizontal bar ---- */
  if (cfg.type === "stacked") {
    const total = values.reduce((sum, value) => sum + Math.abs(value), 0) || 1;

    const barX = 150;
    const barY = Math.max(20, H / 2 - 18);
    const barW = W - barX - 55;
    const barH = 36;

    let currentX = barX;

    return (
      <svg
        className="chart-wrap"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
      >
        {data.map((d, i) => {
          const value = Math.abs(values[i]);
          const width = (value / total) * barW;
          const x = currentX;

          currentX += width;

          return (
            <g key={i}>
              <rect
                x={x}
                y={barY}
                width={Math.max(width, value > 0 ? 1 : 0)}
                height={barH}
                rx="1.5"
                fill={pal[i % pal.length]}
              />

              {cfg.values && value > 0 && (
                <text
                  x={x + width / 2}
                  y={barY + barH / 2 + 4}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#fff"
                  fontWeight="600"
                >
                  {short(value)}
                </text>
              )}
            </g>
          );
        })}

        <text
          x={barX - 10}
          y={barY + barH / 2 + 4}
          textAnchor="end"
          fontSize="11"
          fill="#1A2326"
        >
          Total
        </text>
      </svg>
    );
  }
  /* ============================================================
     HORIZONTAL BARS
     ============================================================ */

  if (cfg.type === "hbar") {
    const padL = Math.min(
      150,
      Math.max(
        ...data.map(
          (d) => String(d.label).length
        )
      ) *
        6.4 +
        10
    );

    const padR = 52;

    const slot =
      (H - 16) / data.length;

    const bh =
      Math.min(28, slot - 6);

    return (
      <svg
        className="chart-wrap"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
      >
        {data.map((d, i) => {
          const y = 10 + i * slot;

          const w = Math.max(
            1,
            (values[i] / max) *
              (W - padL - padR)
          );

          return (
            <g key={i}>
              <rect
                x={padL}
                y={y}
                width={w}
                height={bh}
                rx="1.5"
                fill={
                  pal[i % pal.length]
                }
              />

              <text
                x={padL - 8}
                y={
                  y +
                  bh / 2 +
                  4
                }
                textAnchor="end"
                fontSize="11"
                fill="#1A2326"
              >
                {d.label}
              </text>

              <text
                x={padL + w + 7}
                y={
                  y +
                  bh / 2 +
                  4
                }
                fontSize="10.5"
                fill="#6B7A78"
              >
                {short(values[i])}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  /* ============================================================
     STANDARD BAR / LINE / AREA
     ============================================================ */

  const padL = 54;
  const padR = 12;
  const padT = 12;
  const padB = 30;

  const iw =
    W - padL - padR;

  const ih =
    H - padT - padB;

  const top =
    max * 1.08 || 1;

  const bot =
    Math.min(
      0,
      min * 1.08
    );

  const Y = (v) =>
    padT +
    ih -
    ((v - bot) /
      (top - bot)) *
      ih;

  const step =
    iw / data.length;

  const grid =
    cfg.grid === false
      ? null
      : [0, 1, 2, 3, 4].map(
          (i) => {
            const v =
              bot +
              ((top - bot) *
                i) /
                4;

            const y = Y(v);

            return (
              <g key={i}>
                <line
                  x1={padL}
                  y1={y}
                  x2={W - padR}
                  y2={y}
                  stroke="#E7ECEA"
                  strokeWidth="1"
                />

                <text
                  x={padL - 7}
                  y={y + 3.5}
                  textAnchor="end"
                  fontSize="9.5"
                  fill="#6B7A78"
                >
                  {short(v)}
                </text>
              </g>
            );
          }
        );

  let body;

  /* ============================================================
     SINGLE STACKED BAR

     New mode:

       cfg.type === "bar"
       cfg.displayMode === "stacked"

     Example:

       Approved = 812
       Rejected = 12

       -----------------------------
       |          812 | 12         |
       -----------------------------
          green          red
     ============================================================ */

  if (
    cfg.type === "bar" &&
    cfg.displayMode === "stacked"
  ) {
    const total =
      values.reduce(
        (sum, value) =>
          sum + Math.max(value, 0),
        0
      ) || 1;

    const barX = padL;
    const barW =
      W - padL - padR;

    const barH =
      Math.min(
        42,
        Math.max(
          24,
          H * 0.22
        )
      );

    const barY =
      padT +
      (ih - barH) / 2;

    let currentX = barX;

    body = (
      <>
        {/* Single stacked bar */}
        <g>
          {data.map((d, i) => {
            const value =
              Math.max(
                values[i],
                0
              );

            const width =
              (value / total) *
              barW;

            const x =
              currentX;

            currentX += width;

            if (width <= 0) {
              return null;
            }

            return (
              <g key={i}>
                <rect
                  x={x}
                  y={barY}
                  width={Math.max(
                    width,
                    1
                  )}
                  height={barH}
                  fill={
                    pal[
                      i %
                        pal.length
                    ]
                  }
                />

                {/* Show value when there is enough room */}
                {width >= 42 &&
                  cfg.values !== false && (
                    <text
                      x={
                        x +
                        width / 2
                      }
                      y={
                        barY +
                        barH / 2 +
                        4
                      }
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="600"
                      fill="#fff"
                    >
                      {short(value)}
                    </text>
                  )}
              </g>
            );
          })}
        </g>

        {/* Labels below the single bar */}
        <g>
          {data.map((d, i) => {
            const value =
              Math.max(
                values[i],
                0
              );

            const width =
              (value / total) *
              barW;

            /*
             * Calculate the center of
             * this segment.
             */
            const previous =
              values
                .slice(0, i)
                .reduce(
                  (sum, v) =>
                    sum +
                    Math.max(
                      v,
                      0
                    ),
                  0
                );

            const centerX =
              barX +
              (previous +
                value / 2) /
                total *
                barW;

            return (
              <g key={i}>
                <circle
                  cx={centerX - 24}
                  cy={barY + barH + 18}
                  r="4"
                  fill={
                    pal[
                      i %
                        pal.length
                    ]
                  }
                />

                <text
                  x={centerX - 16}
                  y={barY + barH + 22}
                  textAnchor="start"
                  fontSize="10.5"
                  fill="#6B7A78"
                >
                  {d.label}
                </text>
              </g>
            );
          })}
        </g>
      </>
    );
  }

  /* ============================================================
     NORMAL VERTICAL BAR
     ============================================================ */

  else if (cfg.type === "bar") {
    const bw = Math.max(
      3,
      Math.min(
        46,
        step * 0.62
      )
    );

    body = data.map(
      (d, i) => {
        const x =
          padL +
          step * i +
          (step - bw) / 2;

        const y = Y(
          Math.max(
            values[i],
            0
          )
        );

        const h = Math.abs(
          Y(values[i]) -
            Y(0)
        );

        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={bw}
              height={Math.max(
                1,
                h
              )}
              rx="1.5"
              fill={
                pal[
                  i %
                    pal.length
                ]
              }
            />

            {cfg.values && (
              <text
                x={
                  x +
                  bw / 2
                }
                y={y - 4}
                textAnchor="middle"
                fontSize="9.5"
                fill="#6B7A78"
              >
                {short(
                  values[i]
                )}
              </text>
            )}
          </g>
        );
      }
    );
  }

  /* ============================================================
     LINE / AREA
     ============================================================ */

  else {
    const pts = data.map(
      (_, i) => [
        padL +
          step * i +
          step / 2,
        Y(values[i]),
      ]
    );

    const path = pts
      .map(
        (p, i) =>
          `${
            i
              ? "L"
              : "M"
          }${p[0].toFixed(
            1
          )} ${p[1].toFixed(
            1
          )}`
      )
      .join(" ");

    const base = Y(
      Math.max(
        bot,
        0
      )
    );

    body = (
      <>
        {cfg.type ===
          "area" && (
          <path
            d={`${path} L${
              pts[
                pts.length - 1
              ][0]
            } ${base} L${
              pts[0][0]
            } ${base} Z`}
            fill={pal[0]}
            opacity=".14"
          />
        )}

        <path
          d={path}
          fill="none"
          stroke={pal[0]}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {pts.map(
          (p, i) => (
            <g key={i}>
              <circle
                cx={p[0]}
                cy={p[1]}
                r="3"
                fill="#fff"
                stroke={
                  pal[0]
                }
                strokeWidth="2"
              />

              {cfg.values && (
                <text
                  x={p[0]}
                  y={
                    p[1] - 8
                  }
                  textAnchor="middle"
                  fontSize="9.5"
                  fill="#6B7A78"
                >
                  {short(
                    values[i]
                  )}
                </text>
              )}
            </g>
          )
        )}
      </>
    );
  }

  /* ============================================================
     FINAL SVG
     ============================================================ */

  return (
    <svg
      className="chart-wrap"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
    >
      {grid}

      {body}

      {/* X-axis labels are not needed for stacked mode */}
      {cfg.displayMode !==
        "stacked" &&
        data.map(
          (d, i) => {
            let lab =
              String(
                d.label
              );

            if (
              lab.length >
                11 &&
              data.length >
                5
            ) {
              lab = `${lab.slice(
                0,
                10
              )}…`;
            }

            return (
              <text
                key={i}
                x={
                  padL +
                  step * i +
                  step / 2
                }
                y={
                  H - 9
                }
                textAnchor="middle"
                fontSize="9.5"
                fill="#6B7A78"
              >
                {lab}
              </text>
            );
          }
        )}
    </svg>
  );
}

/* ================================================================
   LEGEND
   ================================================================ */

/* Bars and pies list their categories;
   a line or area names its series. */

export function legendItems(data, cfg) {
  const pal = PALETTE
    .slice(cfg.palette || 0)
    .concat(PALETTE);

  if (["line", "area"].includes(cfg.type)) {
    return [
      {
        label: `${cfg.agg || "SUM"} of ${cfg.column || "value"}`,
        color: pal[0],
      },
    ];
  }

  const total =
    data.reduce(
      (sum, d) => sum + Math.abs(Number(d.value) || 0),
      0
    ) || 1;

  return data.map((d, i) => {
    const value = Math.abs(Number(d.value) || 0);

    const percentage =
      (value / total) * 100;

    return {
      label: String(d.label),
      value,
      percentage,
      color: pal[i % pal.length],
    };
  });
}

export const Legend = ({
  items,
  position,
  showValues = false,
}) => (
  <div
    className={`legend${
      position === "right"
        ? " col"
        : ""
    }`}
  >
    {items.map((d, i) => (
      <span key={i}>
        <i
          style={{
            background: d.color,
          }}
        />

        <span>
          {d.label}

          {showValues &&
            d.value !== undefined && (
              <>
                {" "}
                <b>
                  {short(d.value)}
                </b>

                <small>
                  {" "}
                  ({d.percentage.toFixed(0)}%)
                </small>
              </>
            )}
        </span>
      </span>
    ))}
  </div>
);