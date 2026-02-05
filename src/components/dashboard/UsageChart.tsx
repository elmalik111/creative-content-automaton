import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { TrendingUp } from "lucide-react";

const sampleData = [
  { name: "يناير", value: 30 },
  { name: "فبراير", value: 45 },
  { name: "مارس", value: 58 },
  { name: "أبريل", value: 72 },
  { name: "مايو", value: 90 },
  { name: "يونيو", value: 140 },
  { name: "يوليو", value: 180 },
];

export function UsageChart() {
  return (
    <Card className="card-shadow border-0 bg-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          الاستخدام الشهري
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[260px] w-full" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sampleData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(262, 70%, 55%)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(262, 70%, 55%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(262, 15%, 88%)" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid hsl(262, 15%, 88%)",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="hsl(262, 70%, 55%)"
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 5, stroke: "white", strokeWidth: 2 }}
                fill="url(#lineGradient)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
