from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import pickle
import numpy as np
import pandas as pd
from datetime import date
from fastapi.middleware.cors import CORSMiddleware

# ============================================
# LOAD MODEL & ENCODERS
# ============================================

with open('../models/xgb_demand_model_v2.pkl', 'rb') as f:
    model = pickle.load(f)

with open('../models/label_encoders.pkl', 'rb') as f:
    label_encoders = pickle.load(f)

with open('../models/feature_columns_v2.pkl', 'rb') as f:
    feature_columns = pickle.load(f)

# Load historical sales for lag calculations
df_history = pd.read_csv('../data/train_processed.csv', parse_dates=['date'])
df_history = df_history.sort_values(['store_nbr', 'family', 'date']).reset_index(drop=True)

# Load oil prices
oil = pd.read_csv('../data/oil.csv', parse_dates=['date'])
oil['dcoilwtico'] = oil['dcoilwtico'].ffill().bfill()

app = FastAPI(
    title="Demand Forecasting API",
    description="Predict product demand for Corporación Favorita grocery stores",
    version="1.0.0"
)

# Allow React frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================
# REQUEST & RESPONSE MODELS
# ============================================

class ForecastRequest(BaseModel):
    store_nbr: int
    family: str
    forecast_date: date
    onpromotion: int = 0

class ForecastResponse(BaseModel):
    store_nbr: int
    family: str
    forecast_date: str
    predicted_sales: float
    confidence_note: str

# ============================================
# HELPER FUNCTIONS
# ============================================

def get_lag_features(store_nbr, family, forecast_date):
    """Get historical sales data for lag and rolling features"""
    mask = (df_history['store_nbr'] == store_nbr) & (df_history['family'] == family)
    store_family_data = df_history[mask].sort_values('date')
    
    forecast_dt = pd.Timestamp(forecast_date)
    past_data = store_family_data[store_family_data['date'] < forecast_dt]['sales']
    
    if len(past_data) < 28:
        return None
    
    lag_7 = past_data.iloc[-7]
    lag_14 = past_data.iloc[-14]
    lag_28 = past_data.iloc[-28]
    rolling_7_mean = past_data.iloc[-7:].mean()
    rolling_14_mean = past_data.iloc[-14:].mean()
    rolling_28_mean = past_data.iloc[-28:].mean()
    rolling_7_std = past_data.iloc[-7:].std()
    
    return {
        'lag_7': lag_7,
        'lag_14': lag_14,
        'lag_28': lag_28,
        'rolling_7_mean': rolling_7_mean,
        'rolling_14_mean': rolling_14_mean,
        'rolling_28_mean': rolling_28_mean,
        'rolling_7_std': rolling_7_std
    }

def get_store_info(store_nbr):
    """Get store metadata"""
    stores = pd.read_csv('../data/stores.csv')
    store = stores[stores['store_nbr'] == store_nbr]
    if store.empty:
        return None
    return store.iloc[0]

def get_oil_price(forecast_date):
    """Get the most recent oil price"""
    forecast_dt = pd.Timestamp(forecast_date)
    past_oil = oil[oil['date'] <= forecast_dt]
    if past_oil.empty:
        return oil['dcoilwtico'].mean()
    return past_oil.iloc[-1]['dcoilwtico']

# ============================================
# ENDPOINTS
# ============================================

@app.get("/")
def root():
    return {"message": "Demand Forecasting API is running"}

@app.get("/stores")
def list_stores():
    """List all available stores"""
    stores = pd.read_csv('../data/stores.csv')
    return stores.to_dict(orient='records')

@app.get("/families")
def list_families():
    """List all product families"""
    families = sorted(label_encoders['family'].classes_.tolist())
    return {"families": families}

@app.post("/predict", response_model=ForecastResponse)
def predict(request: ForecastRequest):
    # Validate store number
    store_info = get_store_info(request.store_nbr)
    if store_info is None:
        raise HTTPException(status_code=404, detail=f"Store {request.store_nbr} not found")
    
    # Validate family
    if request.family not in label_encoders['family'].classes_:
        raise HTTPException(status_code=400, detail=f"Unknown product family: {request.family}")
    
    # Get lag features from history
    lags = get_lag_features(request.store_nbr, request.family, request.forecast_date)
    if lags is None:
        raise HTTPException(status_code=400, detail="Not enough historical data for this store/family")
    
    # Build feature vector
    forecast_dt = pd.Timestamp(request.forecast_date)
    
    features = {
        'day_of_week': forecast_dt.dayofweek,
        'day_of_month': forecast_dt.day,
        'month': forecast_dt.month,
        'year': forecast_dt.year,
        'week_of_year': forecast_dt.isocalendar()[1],
        'is_weekend': int(forecast_dt.dayofweek >= 5),
        'is_payday': int(forecast_dt.day == 15 or forecast_dt.is_month_end),
        'is_month_start': int(forecast_dt.day <= 3),
        'store_nbr': request.store_nbr,
        'cluster': int(store_info['cluster']),
        'type_encoded': int(label_encoders['type'].transform([store_info['type']])[0]),
        'city_encoded': int(label_encoders['city'].transform([store_info['city']])[0]),
        'state_encoded': int(label_encoders['state'].transform([store_info['state']])[0]),
        'family_encoded': int(label_encoders['family'].transform([request.family])[0]),
        'onpromotion': request.onpromotion,
        'dcoilwtico': get_oil_price(request.forecast_date),
        'is_national_holiday': 0,
        'is_regional_holiday': 0,
        'is_transferred_holiday': 0,
        'is_holiday': 0,
        'lag_7': lags['lag_7'],
        'lag_14': lags['lag_14'],
        'lag_28': lags['lag_28'],
        'rolling_7_mean': lags['rolling_7_mean'],
        'rolling_14_mean': lags['rolling_14_mean'],
        'rolling_28_mean': lags['rolling_28_mean'],
        'promo_lag_7': 0,
        'promo_rolling_14': 0,
        'rolling_7_std': lags['rolling_7_std'],
        'lag7_to_rolling7_ratio': lags['lag_7'] / (lags['rolling_7_mean'] + 1),
        'day_of_year': forecast_dt.dayofyear,
        'days_to_month_end': forecast_dt.days_in_month - forecast_dt.day,
        'is_december': int(forecast_dt.month == 12),
        'weekend_x_promo': int(forecast_dt.dayofweek >= 5) * request.onpromotion,
    }
    
    # Create DataFrame with correct column order
    X = pd.DataFrame([features])[feature_columns]
    
    # Predict (model was trained on log-transformed target)
    pred_log = model.predict(X)[0]
    pred_sales = float(np.expm1(pred_log))
    pred_sales = max(0, round(pred_sales, 2))
    
    return ForecastResponse(
        store_nbr=request.store_nbr,
        family=request.family,
        forecast_date=str(request.forecast_date),
        predicted_sales=pred_sales,
        confidence_note=f"Based on XGBoost model with MAE of 55.06 units"
    )