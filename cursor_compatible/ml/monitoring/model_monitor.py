import numpy as np
import logging
from scipy.stats import entropy

# Configure logging
logger = logging.getLogger("model_monitor")
logging.basicConfig(level=logging.INFO)

def population_stability_index(expected, actual, bins=10):
    """Compute PSI between expected and actual distributions."""
    expected_hist, bin_edges = np.histogram(expected, bins=bins, density=True)
    actual_hist, _ = np.histogram(actual, bins=bin_edges, density=True)
    expected_hist = np.where(expected_hist == 0, 1e-6, expected_hist)
    actual_hist = np.where(actual_hist == 0, 1e-6, actual_hist)
    psi = np.sum((expected_hist - actual_hist) * np.log(expected_hist / actual_hist))
    return psi

def kl_divergence(p, q, bins=10):
    """Compute KL divergence between two distributions."""
    p_hist, bin_edges = np.histogram(p, bins=bins, density=True)
    q_hist, _ = np.histogram(q, bins=bin_edges, density=True)
    p_hist = np.where(p_hist == 0, 1e-6, p_hist)
    q_hist = np.where(q_hist == 0, 1e-6, q_hist)
    return entropy(p_hist, q_hist)

def mean_squared_error(y_true, y_pred):
    return np.mean((np.array(y_true) - np.array(y_pred)) ** 2)

def accuracy(y_true, y_pred):
    y_true = np.array(y_true)
    y_pred = np.array(y_pred)
    return np.mean(y_true == y_pred)

class ModelMonitor:
    def __init__(self, drift_threshold=0.2, performance_threshold=None, metric='mse'):
        self.drift_threshold = drift_threshold
        self.performance_threshold = performance_threshold
        self.metric = metric
        logger.info(f"Initialized ModelMonitor with drift_threshold={drift_threshold}, performance_threshold={performance_threshold}, metric={metric}")

    def check_drift(self, reference, current):
        psi = population_stability_index(reference, current)
        kl = kl_divergence(reference, current)
        logger.info(f"Drift metrics: PSI={psi:.4f}, KL={kl:.4f}")
        if psi > self.drift_threshold or kl > self.drift_threshold:
            logger.warning(f"Model drift detected! PSI={psi:.4f}, KL={kl:.4f}")
            return True
        return False

    def check_performance(self, y_true, y_pred):
        if self.metric == 'mse':
            perf = mean_squared_error(y_true, y_pred)
        elif self.metric == 'accuracy':
            perf = accuracy(y_true, y_pred)
        else:
            raise ValueError(f"Unsupported metric: {self.metric}")
        logger.info(f"Performance metric ({self.metric}): {perf:.4f}")
        if self.performance_threshold is not None and (
            (self.metric == 'mse' and perf > self.performance_threshold) or
            (self.metric == 'accuracy' and perf < self.performance_threshold)
        ):
            logger.warning(f"Performance degradation detected! {self.metric}={perf:.4f}")
            return True
        return False

if __name__ == "__main__":
    # Minimal test: check drift and performance
    np.random.seed(42)
    reference = np.random.normal(0, 1, 1000)
    current = np.random.normal(0.1, 1.1, 1000)
    y_true = np.random.randint(0, 2, 100)
    y_pred = y_true.copy()
    monitor = ModelMonitor(drift_threshold=0.1, performance_threshold=0.8, metric='accuracy')
    drift = monitor.check_drift(reference, current)
    perf = monitor.check_performance(y_true, y_pred)
    logger.info(f"Drift detected: {drift}, Performance degradation: {perf}") 