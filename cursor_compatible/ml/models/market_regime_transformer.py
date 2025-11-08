import torch
import torch.nn as nn
import torch.nn.functional as F
import logging

# Configure logging
logger = logging.getLogger("market_regime_transformer")
logging.basicConfig(level=logging.INFO)

class MarketRegimeTransformer(nn.Module):
    def __init__(self, input_dim, model_dim=64, num_heads=4, num_layers=2, num_classes=3, dropout=0.1):
        super().__init__()
        self.input_proj = nn.Linear(input_dim, model_dim)
        encoder_layer = nn.TransformerEncoderLayer(d_model=model_dim, nhead=num_heads, dropout=dropout)
        self.transformer_encoder = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        self.classifier = nn.Linear(model_dim, num_classes)
        self.dropout = nn.Dropout(dropout)
        logger.info(f"Initialized MarketRegimeTransformer with input_dim={input_dim}, model_dim={model_dim}, num_heads={num_heads}, num_layers={num_layers}, num_classes={num_classes}")

    def forward(self, x):
        # x: (batch, seq_len, input_dim)
        x = self.input_proj(x)
        x = x.permute(1, 0, 2)  # Transformer expects (seq_len, batch, model_dim)
        x = self.transformer_encoder(x)
        x = x.mean(dim=0)  # Global average pooling over sequence
        x = self.dropout(x)
        logits = self.classifier(x)
        return logits

if __name__ == "__main__":
    # Minimal test: instantiate and run a forward pass
    batch_size = 8
    seq_len = 30
    input_dim = 10
    num_classes = 3
    model = MarketRegimeTransformer(input_dim=input_dim, num_classes=num_classes)
    dummy_input = torch.randn(batch_size, seq_len, input_dim)
    logits = model(dummy_input)
    assert logits.shape == (batch_size, num_classes), f"Expected output shape {(batch_size, num_classes)}, got {logits.shape}"
    logger.info("MarketRegimeTransformer forward pass successful.") 