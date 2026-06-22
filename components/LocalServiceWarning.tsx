"use client";

import { AlertTriangle } from "lucide-react";

export default function LocalServiceWarning() {
  return (
    <div className="cf-local-service-warning" role="alert">
      <AlertTriangle size={20} />
      <div>
        <strong>Local service required</strong>
        <span>
          You must run <code>npm run dev</code> in the CaptionForge project folder for this feature to work.
        </span>
      </div>
      <style>{`
        @keyframes cfWarningFlash {
          0%, 100% { background: rgba(239, 68, 68, .12); border-color: rgba(248, 113, 113, .55); box-shadow: 0 0 0 rgba(239, 68, 68, 0); }
          50% { background: rgba(239, 68, 68, .3); border-color: #ff5c72; box-shadow: 0 0 24px rgba(239, 68, 68, .28); }
        }
        .cf-local-service-warning {
          display: flex;
          align-items: flex-start;
          gap: 11px;
          margin: 0 0 22px;
          padding: 14px 16px;
          color: #ffb3bd;
          border: 1px solid rgba(248, 113, 113, .55);
          border-radius: 12px;
          animation: cfWarningFlash 1.35s ease-in-out infinite;
        }
        .cf-local-service-warning svg { flex: 0 0 auto; margin-top: 1px; color: #ff5c72; }
        .cf-local-service-warning strong { display: block; color: #fff; margin-bottom: 4px; }
        .cf-local-service-warning span { display: block; line-height: 1.45; }
        .cf-local-service-warning code {
          color: #fff;
          background: rgba(0,0,0,.28);
          border-radius: 5px;
          padding: 2px 5px;
        }
        @media (prefers-reduced-motion: reduce) {
          .cf-local-service-warning { animation: none; background: rgba(239, 68, 68, .2); }
        }
      `}</style>
    </div>
  );
}
