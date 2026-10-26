import { CSV_TEMPLATE } from "@/connectors/claudeCsv";

export function GET() {
  return new Response(CSV_TEMPLATE, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="lasso-claude-usage-template.csv"',
    },
  });
}
