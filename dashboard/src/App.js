import React, { useState, useEffect } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import "./App.css";

const API_URL = "http://127.0.0.1:8000";

function App() {
  // State
  const [stores, setStores] = useState([]);
  const [families, setFamilies] = useState([]);
  const [selectedStore, setSelectedStore] = useState(1);
  const [selectedFamily, setSelectedFamily] = useState("BEVERAGES");
  const [startDate, setStartDate] = useState(new Date("2017-07-16"));
  const [endDate, setEndDate] = useState(new Date("2017-08-15"));
  const [onPromotion, setOnPromotion] = useState(0);
  const [forecasts, setForecasts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [storeInfo, setStoreInfo] = useState(null);

  // Load stores and families on mount
  useEffect(() => {
    fetch(`${API_URL}/stores`)
      .then((res) => res.json())
      .then((data) => setStores(data))
      .catch((err) =>
        setError("Cannot connect to API. Is the server running?"),
      );

    fetch(`${API_URL}/families`)
      .then((res) => res.json())
      .then((data) => setFamilies(data.families))
      .catch((err) => setError("Cannot connect to API."));
  }, []);

  // Update store info when store changes
  useEffect(() => {
    const info = stores.find((s) => s.store_nbr === selectedStore);
    setStoreInfo(info);
  }, [selectedStore, stores]);

  // Generate date range
  const getDateRange = (start, end) => {
    const dates = [];
    let current = new Date(start);
    while (current <= end) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return dates;
  };

  // Run forecast
  const handleForecast = async () => {
    setLoading(true);
    setError(null);
    setForecasts([]);

    const dates = getDateRange(startDate, endDate);
    const results = [];

    try {
      for (const date of dates) {
        const dateStr = date.toISOString().split("T")[0];
        const response = await fetch(`${API_URL}/predict`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            store_nbr: selectedStore,
            family: selectedFamily,
            forecast_date: dateStr,
            onpromotion: onPromotion,
          }),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.detail || "Prediction failed");
        }

        const data = await response.json();
        results.push({
          date: dateStr,
          predicted_sales: data.predicted_sales,
          day: new Date(dateStr).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          }),
        });
      }

      setForecasts(results);
    } catch (err) {
      setError(err.message);
    }

    setLoading(false);
  };

  // Calculate summary stats
  const totalSales = forecasts.reduce((sum, f) => sum + f.predicted_sales, 0);
  const avgSales = forecasts.length > 0 ? totalSales / forecasts.length : 0;
  const peakDay =
    forecasts.length > 0
      ? forecasts.reduce(
          (max, f) => (f.predicted_sales > max.predicted_sales ? f : max),
          forecasts[0],
        )
      : null;
  const lowDay =
    forecasts.length > 0
      ? forecasts.reduce(
          (min, f) => (f.predicted_sales < min.predicted_sales ? f : min),
          forecasts[0],
        )
      : null;

  return (
    <div className="app">
      <header className="header">
        <h1>Demand Forecasting Dashboard</h1>
        <p>Corporación Favorita Grocery Sales Prediction</p>
      </header>

      <div className="main-layout">
        {/* Control Panel */}
        <div className="control-panel">
          <h2>Forecast Parameters</h2>

          <div className="control-group">
            <label>Store</label>
            <select
              value={selectedStore}
              onChange={(e) => setSelectedStore(Number(e.target.value))}
            >
              {stores.map((s) => (
                <option key={s.store_nbr} value={s.store_nbr}>
                  Store {s.store_nbr} - {s.city} (Type {s.type})
                </option>
              ))}
            </select>
          </div>

          {storeInfo && (
            <div className="store-info">
              <p>
                <strong>City:</strong> {storeInfo.city}
              </p>
              <p>
                <strong>State:</strong> {storeInfo.state}
              </p>
              <p>
                <strong>Type:</strong> {storeInfo.type}
              </p>
              <p>
                <strong>Cluster:</strong> {storeInfo.cluster}
              </p>
            </div>
          )}

          <div className="control-group">
            <label>Product Family</label>
            <select
              value={selectedFamily}
              onChange={(e) => setSelectedFamily(e.target.value)}
            >
              {families.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <label>Start Date</label>
            <DatePicker
              selected={startDate}
              onChange={(date) => setStartDate(date)}
              dateFormat="yyyy-MM-dd"
            />
          </div>

          <div className="control-group">
            <label>End Date</label>
            <DatePicker
              selected={endDate}
              onChange={(date) => setEndDate(date)}
              dateFormat="yyyy-MM-dd"
            />
          </div>

          <div className="control-group">
            <label>On Promotion</label>
            <select
              value={onPromotion}
              onChange={(e) => setOnPromotion(Number(e.target.value))}
            >
              <option value={0}>No</option>
              <option value={1}>Yes</option>
            </select>
          </div>

          <button
            className="forecast-btn"
            onClick={handleForecast}
            disabled={loading}
          >
            {loading ? "Forecasting..." : "Run Forecast"}
          </button>

          {error && <div className="error">{error}</div>}
        </div>

        {/* Results Panel */}
        <div className="results-panel">
          {/* Summary Cards */}
          {forecasts.length > 0 && (
            <div className="summary-cards">
              <div className="card">
                <h3>Total Predicted</h3>
                <p className="card-value">
                  {totalSales.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                </p>
                <span>units</span>
              </div>
              <div className="card">
                <h3>Daily Average</h3>
                <p className="card-value">
                  {avgSales.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                </p>
                <span>units/day</span>
              </div>
              <div className="card peak">
                <h3>Peak Day</h3>
                <p className="card-value">
                  {peakDay?.predicted_sales.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                </p>
                <span>{peakDay?.day}</span>
              </div>
              <div className="card low">
                <h3>Lowest Day</h3>
                <p className="card-value">
                  {lowDay?.predicted_sales.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                </p>
                <span>{lowDay?.day}</span>
              </div>
            </div>
          )}

          {/* Line Chart */}
          {forecasts.length > 0 && (
            <div className="chart-container">
              <h2>Sales Forecast</h2>
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={forecasts}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 11 }}
                    angle={-35}
                    textAnchor="end"
                    height={70}
                  />
                  <YAxis />
                  <Tooltip
                    formatter={(value) => [
                      value.toLocaleString(undefined, {
                        maximumFractionDigits: 1,
                      }),
                      "Predicted Sales",
                    ]}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="predicted_sales"
                    stroke="#4A90D9"
                    strokeWidth={2.5}
                    dot={{ r: 4 }}
                    name="Predicted Sales"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Bar Chart */}
          {forecasts.length > 0 && (
            <div className="chart-container">
              <h2>Daily Breakdown</h2>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={forecasts}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 11 }}
                    angle={-35}
                    textAnchor="end"
                    height={70}
                  />
                  <YAxis />
                  <Tooltip
                    formatter={(value) => [
                      value.toLocaleString(undefined, {
                        maximumFractionDigits: 1,
                      }),
                      "Predicted Sales",
                    ]}
                  />
                  <Bar
                    dataKey="predicted_sales"
                    fill="#4A90D9"
                    name="Predicted Sales"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Empty State */}
          {forecasts.length === 0 && !loading && (
            <div className="empty-state">
              <h2>Select parameters and click "Run Forecast"</h2>
              <p>
                Choose a store, product family, and date range to generate
                demand predictions.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
