import torch
import torch.nn as nn
import logging

# Configure logging
logger = logging.getLogger("volatility_forecaster")
logging.basicConfig(level=logging.INFO)

class VolatilityForecaster(nn.Module):
    def __init__(self, input_dim, hidden_dim=64, num_layers=2, dropout=0.1):
        super().__init__()
        self.lstm = nn.LSTM(input_dim, hidden_dim, num_layers=num_layers, batch_first=True, dropout=dropout)
        self.fc = nn.Linear(hidden_dim, 1)  # Output: predicted volatility
        self.dropout = nn.Dropout(dropout)
        logger.info(f"Initialized VolatilityForecaster with input_dim={input_dim}, hidden_dim={hidden_dim}, num_layers={num_layers}")

    def forward(self, x):
        # x: (batch, seq_len, input_dim)
        out, _ = self.lstm(x)
        out = self.dropout(out[:, -1, :])  # Use last time step
        out = self.fc(out)
        return out.squeeze(-1)  # (batch,)

if __name__ == "__main__":
    # Minimal test: instantiate and run a forward pass
    batch_size = 8
    seq_len = 30
    input_dim = 10
    model = VolatilityForecaster(input_dim=input_dim)
    dummy_input = torch.randn(batch_size, seq_len, input_dim)
    output = model(dummy_input)
    assert output.shape == (batch_size,), f"Expected output shape ({batch_size},), got {output.shape}"
    logger.info("VolatilityForecaster forward pass successful.") 