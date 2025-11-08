// MIT License
// 
// Copyright (c) 2023 Noderr Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

use std::sync::Arc;
use axum::{
    async_trait,
    extract::{FromRequestParts, TypedHeader},
    headers::{authorization::Bearer, Authorization},
    http::{StatusCode, request::Parts},
    response::{Response, IntoResponse},
    RequestPartsExt,
    Json,
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation, Algorithm};
use serde::{Serialize, Deserialize};
use secrecy::{Secret, ExposeSecret};
use thiserror::Error;
use tokio::sync::RwLock;
use std::collections::{HashSet, HashMap};
use time::{Duration, OffsetDateTime};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::telemetry::{TelemetryPermissions, TelemetryRole};

/// JWT claims structure
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    /// Subject (user ID)
    sub: String,
    /// User's name
    name: String,
    /// User's email
    email: String, 
    /// User's role
    role: String,
    /// Strategy IDs the user has access to
    #[serde(default)]
    strategy_ids: Vec<String>,
    /// Issued at timestamp
    iat: i64,
    /// Expiration timestamp
    exp: i64,
    /// Issuer
    iss: String,
}

/// Authenticated user information
#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    /// User ID
    pub id: String,
    /// User's name
    pub name: String,
    /// User's email
    pub email: String,
    /// User's role
    pub role: TelemetryRole,
    /// Strategy IDs the user has access to
    pub strategy_ids: Vec<String>,
}

impl AuthenticatedUser {
    /// Create telemetry permissions based on user role and strategy IDs
    pub fn telemetry_permissions(&self) -> TelemetryPermissions {
        match self.role {
            TelemetryRole::Admin => TelemetryPermissions::new_admin(),
            TelemetryRole::Operator => TelemetryPermissions::new_operator(),
            TelemetryRole::Developer => TelemetryPermissions::new_developer(),
            TelemetryRole::StrategyOwner => TelemetryPermissions::new_strategy_owner(&self.strategy_ids),
            TelemetryRole::Viewer => TelemetryPermissions::new_viewer(&self.strategy_ids),
        }
    }
}

/// Auth configuration
#[derive(Clone)]
pub struct AuthConfig {
    /// JWT encoding key
    encoding_key: Arc<EncodingKey>,
    /// JWT decoding key
    decoding_key: Arc<DecodingKey>,
    /// JWT issuer
    issuer: String,
    /// JWT token validity duration in seconds
    token_validity: i64,
}

impl AuthConfig {
    /// Create a new auth configuration
    pub fn new(secret: &str, issuer: &str, token_validity: i64) -> Self {
        Self {
            encoding_key: Arc::new(EncodingKey::from_secret(secret.as_bytes())),
            decoding_key: Arc::new(DecodingKey::from_secret(secret.as_bytes())),
            issuer: issuer.to_string(),
            token_validity,
        }
    }
}

/// User manager for authentication and authorization
pub struct UserManager {
    /// Auth configuration
    config: AuthConfig,
    /// User database
    users: RwLock<HashMap<String, UserRecord>>,
}

/// User record in the user database
#[derive(Debug, Clone, Serialize, Deserialize)]
struct UserRecord {
    /// User ID
    id: String,
    /// User's name
    name: String,
    /// User's email
    email: String,
    /// User's hashed password
    password_hash: String,
    /// User's role
    role: TelemetryRole,
    /// Strategy IDs the user has access to
    strategy_ids: Vec<String>,
    /// Created timestamp
    created_at: i64,
    /// Last login timestamp
    last_login: Option<i64>,
}

/// Login request
#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    /// User's email
    email: String,
    /// User's password
    password: String,
}

/// Login response
#[derive(Debug, Serialize)]
pub struct LoginResponse {
    /// JWT token
    token: String,
    /// User info
    user: UserInfo,
}

/// User info for API responses
#[derive(Debug, Serialize)]
pub struct UserInfo {
    /// User ID
    id: String,
    /// User's name
    name: String,
    /// User's email
    email: String,
    /// User's role
    role: String,
    /// Strategy IDs the user has access to
    strategy_ids: Vec<String>,
}

/// Create user request
#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    /// User's name
    name: String,
    /// User's email
    email: String,
    /// User's password
    password: String,
    /// User's role
    role: String,
    /// Strategy IDs the user has access to
    #[serde(default)]
    strategy_ids: Vec<String>,
}

/// Auth error
#[derive(Debug, Error)]
pub enum AuthError {
    /// Invalid credentials
    #[error("Invalid credentials")]
    InvalidCredentials,
    /// Invalid token
    #[error("Invalid token")]
    InvalidToken,
    /// Missing token
    #[error("Missing token")]
    MissingToken,
    /// User not found
    #[error("User not found")]
    UserNotFound,
    /// Email already taken
    #[error("Email already taken")]
    EmailTaken,
    /// JWT error
    #[error("JWT error: {0}")]
    JwtError(#[from] jsonwebtoken::errors::Error),
    /// Internal error
    #[error("Internal error: {0}")]
    InternalError(String),
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AuthError::InvalidCredentials => (StatusCode::UNAUTHORIZED, "Invalid credentials"),
            AuthError::InvalidToken => (StatusCode::UNAUTHORIZED, "Invalid token"),
            AuthError::MissingToken => (StatusCode::UNAUTHORIZED, "Missing token"),
            AuthError::UserNotFound => (StatusCode::NOT_FOUND, "User not found"),
            AuthError::EmailTaken => (StatusCode::CONFLICT, "Email already taken"),
            AuthError::JwtError(_) => (StatusCode::UNAUTHORIZED, "Invalid token"),
            AuthError::InternalError(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error"),
        };
        
        let body = Json(serde_json::json!({
            "error": message,
        }));
        
        (status, body).into_response()
    }
}

#[async_trait]
impl<S> FromRequestParts<S> for AuthenticatedUser
where
    S: Send + Sync,
{
    type Rejection = AuthError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        // Extract the token from the Authorization header
        let TypedHeader(Authorization(bearer)) = parts
            .extract::<TypedHeader<Authorization<Bearer>>>()
            .await
            .map_err(|_| AuthError::MissingToken)?;
        
        // Get auth config from app state
        let user_manager = parts
            .extensions
            .get::<Arc<UserManager>>()
            .ok_or_else(|| AuthError::InternalError("UserManager not found in app state".to_string()))?;
        
        // Validate the token
        user_manager.validate_token(bearer.token()).await
    }
}

impl UserManager {
    /// Create a new user manager
    pub fn new(config: AuthConfig) -> Self {
        Self {
            config,
            users: RwLock::new(HashMap::new()),
        }
    }
    
    /// Initialize with default admin user
    pub async fn init_with_default_admin(&self, admin_email: &str, admin_password: &str) -> Result<(), AuthError> {
        let users = self.users.read().await;
        if !users.is_empty() {
            // Already initialized
            return Ok(());
        }
        drop(users);
        
        // Create admin user
        let admin_id = Uuid::new_v4().to_string();
        let password_hash = hash_password(admin_password)?;
        
        let admin = UserRecord {
            id: admin_id.clone(),
            name: "Admin".to_string(),
            email: admin_email.to_string(),
            password_hash,
            role: TelemetryRole::Admin,
            strategy_ids: vec![],
            created_at: OffsetDateTime::now_utc().unix_timestamp(),
            last_login: None,
        };
        
        let mut users = self.users.write().await;
        users.insert(admin_id, admin);
        
        info!("Created default admin user with email: {}", admin_email);
        Ok(())
    }
    
    /// Login a user and generate a JWT token
    pub async fn login(&self, email: &str, password: &str) -> Result<(String, UserInfo), AuthError> {
        let users = self.users.read().await;
        
        // Find user by email
        let user = users
            .values()
            .find(|u| u.email == email)
            .ok_or(AuthError::InvalidCredentials)?;
        
        // Verify password
        if !verify_password(password, &user.password_hash)? {
            return Err(AuthError::InvalidCredentials);
        }
        
        // Generate token
        let now = OffsetDateTime::now_utc();
        let iat = now.unix_timestamp();
        let exp = (now + Duration::seconds(self.config.token_validity)).unix_timestamp();
        
        let claims = Claims {
            sub: user.id.clone(),
            name: user.name.clone(),
            email: user.email.clone(),
            role: telemetry_role_to_string(&user.role),
            strategy_ids: user.strategy_ids.clone(),
            iat,
            exp,
            iss: self.config.issuer.clone(),
        };
        
        let token = encode(
            &Header::default(),
            &claims,
            &self.config.encoding_key,
        )?;
        
        // Update last login time
        drop(users);
        
        let mut users = self.users.write().await;
        if let Some(user) = users.get_mut(&user.id) {
            user.last_login = Some(iat);
        }
        
        let user_info = UserInfo {
            id: user.id.clone(),
            name: user.name.clone(),
            email: user.email.clone(),
            role: telemetry_role_to_string(&user.role),
            strategy_ids: user.strategy_ids.clone(),
        };
        
        Ok((token, user_info))
    }
    
    /// Validate a JWT token and return the authenticated user
    pub async fn validate_token(&self, token: &str) -> Result<AuthenticatedUser, AuthError> {
        // Decode and validate the token
        let token_data = decode::<Claims>(
            token,
            &self.config.decoding_key,
            &Validation::new(Algorithm::HS256),
        )?;
        
        let claims = token_data.claims;
        
        // Verify the issuer
        if claims.iss != self.config.issuer {
            return Err(AuthError::InvalidToken);
        }
        
        // Verify the user exists
        let users = self.users.read().await;
        let user = users
            .get(&claims.sub)
            .ok_or(AuthError::UserNotFound)?;
        
        // Convert role string to TelemetryRole
        let role = string_to_telemetry_role(&claims.role)
            .unwrap_or(TelemetryRole::Viewer);
        
        Ok(AuthenticatedUser {
            id: claims.sub,
            name: claims.name,
            email: claims.email,
            role,
            strategy_ids: claims.strategy_ids,
        })
    }
    
    /// Create a new user
    pub async fn create_user(&self, request: CreateUserRequest) -> Result<UserInfo, AuthError> {
        let users = self.users.read().await;
        
        // Check if email is already taken
        if users.values().any(|u| u.email == request.email) {
            return Err(AuthError::EmailTaken);
        }
        
        drop(users);
        
        // Hash password
        let password_hash = hash_password(&request.password)?;
        
        // Convert role string to TelemetryRole
        let role = string_to_telemetry_role(&request.role)
            .unwrap_or(TelemetryRole::Viewer);
        
        // Create user record
        let user_id = Uuid::new_v4().to_string();
        let user = UserRecord {
            id: user_id.clone(),
            name: request.name,
            email: request.email.clone(),
            password_hash,
            role,
            strategy_ids: request.strategy_ids.clone(),
            created_at: OffsetDateTime::now_utc().unix_timestamp(),
            last_login: None,
        };
        
        // Add user to database
        let mut users = self.users.write().await;
        users.insert(user_id.clone(), user.clone());
        
        let user_info = UserInfo {
            id: user_id,
            name: user.name,
            email: user.email,
            role: telemetry_role_to_string(&user.role),
            strategy_ids: user.strategy_ids,
        };
        
        Ok(user_info)
    }
    
    /// Get a user by ID
    pub async fn get_user(&self, user_id: &str) -> Result<UserInfo, AuthError> {
        let users = self.users.read().await;
        
        let user = users
            .get(user_id)
            .ok_or(AuthError::UserNotFound)?;
        
        let user_info = UserInfo {
            id: user.id.clone(),
            name: user.name.clone(),
            email: user.email.clone(),
            role: telemetry_role_to_string(&user.role),
            strategy_ids: user.strategy_ids.clone(),
        };
        
        Ok(user_info)
    }
    
    /// List all users
    pub async fn list_users(&self) -> Vec<UserInfo> {
        let users = self.users.read().await;
        
        users
            .values()
            .map(|user| UserInfo {
                id: user.id.clone(),
                name: user.name.clone(),
                email: user.email.clone(),
                role: telemetry_role_to_string(&user.role),
                strategy_ids: user.strategy_ids.clone(),
            })
            .collect()
    }
    
    /// Delete a user
    pub async fn delete_user(&self, user_id: &str) -> Result<(), AuthError> {
        let mut users = self.users.write().await;
        
        if users.remove(user_id).is_none() {
            return Err(AuthError::UserNotFound);
        }
        
        Ok(())
    }
}

/// Hash a password using bcrypt
fn hash_password(password: &str) -> Result<String, AuthError> {
    // Note: In a real implementation, use a proper password hashing library like bcrypt
    // This is a simplified example for demonstration
    
    // For now, we'll just append a fixed salt to demonstrate the concept
    // DO NOT use this in production!
    let salt = "noderr_salt";
    let hashed = format!("{}:{}", salt, password);
    
    Ok(hashed)
}

/// Verify a password against a hash
fn verify_password(password: &str, hash: &str) -> Result<bool, AuthError> {
    // Note: In a real implementation, use a proper password hashing library
    // This is a simplified example for demonstration
    
    // Parse the salt from the hash
    let parts: Vec<&str> = hash.split(':').collect();
    if parts.len() != 2 {
        return Err(AuthError::InternalError("Invalid password hash format".to_string()));
    }
    
    let salt = parts[0];
    let expected = format!("{}:{}", salt, password);
    
    Ok(hash == expected)
}

/// Convert TelemetryRole to string
fn telemetry_role_to_string(role: &TelemetryRole) -> String {
    match role {
        TelemetryRole::Admin => "admin".to_string(),
        TelemetryRole::Operator => "operator".to_string(),
        TelemetryRole::Developer => "developer".to_string(),
        TelemetryRole::StrategyOwner => "strategy_owner".to_string(),
        TelemetryRole::Viewer => "viewer".to_string(),
    }
}

/// Convert string to TelemetryRole
fn string_to_telemetry_role(role: &str) -> Option<TelemetryRole> {
    match role.to_lowercase().as_str() {
        "admin" => Some(TelemetryRole::Admin),
        "operator" => Some(TelemetryRole::Operator),
        "developer" => Some(TelemetryRole::Developer),
        "strategy_owner" => Some(TelemetryRole::StrategyOwner),
        "viewer" => Some(TelemetryRole::Viewer),
        _ => None,
    }
}