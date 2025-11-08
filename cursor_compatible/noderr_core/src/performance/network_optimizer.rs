use std::net::{TcpStream, UdpSocket};
use std::os::unix::io::AsRawFd;
use std::time::Duration;
use libc::{c_int, c_void, setsockopt, SOL_SOCKET, SO_RCVBUF, SO_SNDBUF, IPPROTO_TCP, TCP_NODELAY};

/// Network optimization configuration
pub struct NetworkConfig {
    /// TCP receive buffer size
    pub tcp_recv_buffer: usize,
    /// TCP send buffer size  
    pub tcp_send_buffer: usize,
    /// UDP receive buffer size
    pub udp_recv_buffer: usize,
    /// UDP send buffer size
    pub udp_send_buffer: usize,
    /// Enable TCP_NODELAY
    pub tcp_nodelay: bool,
    /// TCP keepalive interval
    pub tcp_keepalive: Option<Duration>,
    /// Congestion control algorithm
    pub congestion_control: String,
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            tcp_recv_buffer: 8 * 1024 * 1024,  // 8MB
            tcp_send_buffer: 8 * 1024 * 1024,  // 8MB
            udp_recv_buffer: 4 * 1024 * 1024,  // 4MB
            udp_send_buffer: 4 * 1024 * 1024,  // 4MB
            tcp_nodelay: true,
            tcp_keepalive: Some(Duration::from_secs(30)),
            congestion_control: "bbr".to_string(),
        }
    }
}

/// Network optimizer for low-latency trading
pub struct NetworkOptimizer {
    config: NetworkConfig,
}

impl NetworkOptimizer {
    pub fn new(config: NetworkConfig) -> Self {
        Self { config }
    }

    /// Optimize TCP socket for low latency
    pub fn optimize_tcp_socket(&self, socket: &TcpStream) -> Result<(), std::io::Error> {
        let fd = socket.as_raw_fd();
        
        // Set receive buffer size
        unsafe {
            let size = self.config.tcp_recv_buffer as c_int;
            if setsockopt(fd, SOL_SOCKET, SO_RCVBUF, 
                         &size as *const _ as *const c_void, 
                         std::mem::size_of::<c_int>() as u32) != 0 {
                return Err(std::io::Error::last_os_error());
            }
        }
        
        // Set send buffer size
        unsafe {
            let size = self.config.tcp_send_buffer as c_int;
            if setsockopt(fd, SOL_SOCKET, SO_SNDBUF,
                         &size as *const _ as *const c_void,
                         std::mem::size_of::<c_int>() as u32) != 0 {
                return Err(std::io::Error::last_os_error());
            }
        }
        
        // Enable TCP_NODELAY
        if self.config.tcp_nodelay {
            unsafe {
                let nodelay: c_int = 1;
                if setsockopt(fd, IPPROTO_TCP, TCP_NODELAY,
                             &nodelay as *const _ as *const c_void,
                             std::mem::size_of::<c_int>() as u32) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
            }
        }
        
        // Set keepalive
        if let Some(keepalive) = self.config.tcp_keepalive {
            socket.set_keepalive(Some(keepalive))?;
        }
        
        Ok(())
    }
    
    /// Optimize UDP socket for market data
    pub fn optimize_udp_socket(&self, socket: &UdpSocket) -> Result<(), std::io::Error> {
        let fd = socket.as_raw_fd();
        
        // Set receive buffer size
        unsafe {
            let size = self.config.udp_recv_buffer as c_int;
            if setsockopt(fd, SOL_SOCKET, SO_RCVBUF,
                         &size as *const _ as *const c_void,
                         std::mem::size_of::<c_int>() as u32) != 0 {
                return Err(std::io::Error::last_os_error());
            }
        }
        
        // Set send buffer size
        unsafe {
            let size = self.config.udp_send_buffer as c_int;
            if setsockopt(fd, SOL_SOCKET, SO_SNDBUF,
                         &size as *const _ as *const c_void,
                         std::mem::size_of::<c_int>() as u32) != 0 {
                return Err(std::io::Error::last_os_error());
            }
        }
        
        Ok(())
    }
    
    /// Apply kernel-level optimizations (requires root)
    pub fn apply_kernel_optimizations(&self) -> Result<(), std::io::Error> {
        // These would typically be set via sysctl
        println!("Kernel optimizations:");
        println!("  net.core.rmem_max = {}", self.config.tcp_recv_buffer * 2);
        println!("  net.core.wmem_max = {}", self.config.tcp_send_buffer * 2);
        println!("  net.ipv4.tcp_congestion_control = {}", self.config.congestion_control);
        println!("  net.core.netdev_max_backlog = 5000");
        println!("  net.ipv4.tcp_fastopen = 3");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_default_config() {
        let config = NetworkConfig::default();
        assert_eq!(config.tcp_recv_buffer, 8 * 1024 * 1024);
        assert_eq!(config.tcp_nodelay, true);
        assert_eq!(config.congestion_control, "bbr");
    }
} 