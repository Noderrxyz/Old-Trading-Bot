import streamlit as st
import pandas as pd
import numpy as np
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("strategy_performance_dashboard")

st.set_page_config(page_title="Strategy Performance Dashboard", layout="wide")
st.title("Strategy Performance Monitoring")

# Simulate or load strategy performance data
def load_performance_data():
    try:
        np.random.seed(42)
        dates = pd.date_range(end=pd.Timestamp.today(), periods=180)
        pnl = np.cumsum(np.random.randn(180))
        returns = np.random.randn(180) * 0.01
        drawdown = np.maximum.accumulate(pnl) - pnl
        win_rate = np.mean(returns > 0)
        sharpe = np.mean(returns) / (np.std(returns) + 1e-8) * np.sqrt(252)
        df = pd.DataFrame({
            "date": dates,
            "pnl": pnl,
            "returns": returns,
            "drawdown": drawdown
        })
        logger.info("Loaded performance data successfully.")
        return df, sharpe, win_rate
    except Exception as e:
        logger.error(f"Error loading performance data: {e}")
        st.error("Failed to load performance data.")
        return pd.DataFrame(), 0, 0

data, sharpe, win_rate = load_performance_data()

if not data.empty:
    st.metric("Sharpe Ratio", f"{sharpe:.2f}")
    st.metric("Win Rate", f"{win_rate*100:.1f}%")
    st.line_chart(data.set_index("date")["pnl"], use_container_width=True)
    st.line_chart(data.set_index("date")["drawdown"], use_container_width=True)
    st.line_chart(data.set_index("date")["returns"], use_container_width=True)
    st.dataframe(data.tail(20), use_container_width=True)
else:
    st.warning("No performance data available.") 