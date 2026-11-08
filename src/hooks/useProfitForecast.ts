import { useMemo } from "react";
import { subDays, addDays, format } from "date-fns";
import { DailyProfitState } from "./useDailyProfit";

export interface ForecastPoint {
  date: string;
  predicted: number;
  lower: number;
  upper: number;
  isHistorical?: boolean;
  actual?: number;
}

export interface ForecastResult {
  forecasts: ForecastPoint[];
  trend: "up" | "down" | "stable";
  trendPercentage: number;
  averageProfit: number;
  projectedWeekly: number;
  projectedMonthly: number;
  confidence: number;
}

// Simple linear regression
function linearRegression(data: { x: number; y: number }[]): { slope: number; intercept: number; r2: number } {
  const n = data.length;
  if (n < 2) return { slope: 0, intercept: data[0]?.y || 0, r2: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  
  for (const point of data) {
    sumX += point.x;
    sumY += point.y;
    sumXY += point.x * point.y;
    sumX2 += point.x * point.x;
    sumY2 += point.y * point.y;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  // Calculate R-squared
  const yMean = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (const point of data) {
    const predicted = slope * point.x + intercept;
    ssTot += Math.pow(point.y - yMean, 2);
    ssRes += Math.pow(point.y - predicted, 2);
  }
  const r2 = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;

  return { slope, intercept, r2: Math.max(0, Math.min(1, r2)) };
}

// Calculate standard deviation
function standardDeviation(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (n - 1);
  return Math.sqrt(variance);
}

// Moving average for smoothing
function movingAverage(data: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - window + 1);
    const windowSlice = data.slice(start, i + 1);
    result.push(windowSlice.reduce((a, b) => a + b, 0) / windowSlice.length);
  }
  return result;
}

export function useProfitForecast(
  historicalData: DailyProfitState[],
  forecastDays: number = 7
): ForecastResult {
  return useMemo(() => {
    if (!historicalData || historicalData.length < 3) {
      return {
        forecasts: [],
        trend: "stable" as const,
        trendPercentage: 0,
        averageProfit: 0,
        projectedWeekly: 0,
        projectedMonthly: 0,
        confidence: 0,
      };
    }

    // Sort by date and get profits
    const sortedData = [...historicalData].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    
    const profits = sortedData.map((d) => d.operatingProfit);
    const smoothedProfits = movingAverage(profits, 3);
    
    // Prepare regression data
    const regressionData = smoothedProfits.map((y, x) => ({ x, y }));
    const { slope, intercept, r2 } = linearRegression(regressionData);
    
    // Calculate residuals for confidence intervals
    const residuals = profits.map((actual, i) => actual - (slope * i + intercept));
    const stdDev = standardDeviation(residuals);
    
    // Generate forecasts
    const lastDate = new Date(sortedData[sortedData.length - 1].date);
    const forecasts: ForecastPoint[] = [];
    
    // Add historical points
    sortedData.forEach((day, i) => {
      forecasts.push({
        date: day.date,
        predicted: slope * i + intercept,
        lower: slope * i + intercept - 1.96 * stdDev,
        upper: slope * i + intercept + 1.96 * stdDev,
        isHistorical: true,
        actual: day.operatingProfit,
      });
    });
    
    // Add forecast points
    const n = sortedData.length;
    for (let i = 1; i <= forecastDays; i++) {
      const x = n - 1 + i;
      const predicted = slope * x + intercept;
      const forecastDate = addDays(lastDate, i);
      
      // Increase uncertainty for further predictions
      const uncertaintyMultiplier = 1 + (i * 0.1);
      
      forecasts.push({
        date: format(forecastDate, "yyyy-MM-dd"),
        predicted: Math.max(0, predicted),
        lower: Math.max(0, predicted - 1.96 * stdDev * uncertaintyMultiplier),
        upper: predicted + 1.96 * stdDev * uncertaintyMultiplier,
        isHistorical: false,
      });
    }
    
    // Calculate trend
    const averageProfit = profits.reduce((a, b) => a + b, 0) / profits.length;
    const firstHalfAvg = profits.slice(0, Math.floor(profits.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(profits.length / 2);
    const secondHalfAvg = profits.slice(Math.floor(profits.length / 2)).reduce((a, b) => a + b, 0) / (profits.length - Math.floor(profits.length / 2));
    
    const trendPercentage = firstHalfAvg !== 0 
      ? ((secondHalfAvg - firstHalfAvg) / Math.abs(firstHalfAvg)) * 100 
      : 0;
    
    let trend: "up" | "down" | "stable" = "stable";
    if (trendPercentage > 5) trend = "up";
    else if (trendPercentage < -5) trend = "down";
    
    // Project weekly and monthly
    const lastPredicted = slope * (n - 1) + intercept;
    const weeklySlope = slope * 7;
    const monthlySlope = slope * 30;
    
    const projectedWeekly = Math.max(0, lastPredicted * 7 + weeklySlope);
    const projectedMonthly = Math.max(0, lastPredicted * 30 + monthlySlope);
    
    return {
      forecasts,
      trend,
      trendPercentage,
      averageProfit,
      projectedWeekly,
      projectedMonthly,
      confidence: r2 * 100,
    };
  }, [historicalData, forecastDays]);
}
