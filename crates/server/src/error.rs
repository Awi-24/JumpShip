//! FastAPI error shapes: `{"detail": "<msg>"}` for HTTPException, `422 {"detail": [{loc, msg, type}]}` for bad bodies.

use axum::extract::rejection::JsonRejection;
use axum::extract::{FromRequest, Request};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::de::DeserializeOwned;
use serde_json::json;

#[derive(Debug)]
pub struct ApiError(pub StatusCode, pub String);

impl ApiError {
    pub fn new(status: u16, detail: impl Into<String>) -> ApiError {
        ApiError(StatusCode::from_u16(status).unwrap(), detail.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, axum::Json(json!({"detail": self.1}))).into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

/// JSON body extractor whose rejection looks like FastAPI's validation error.
pub struct Body<T>(pub T);

impl<S: Send + Sync, T: DeserializeOwned> FromRequest<S> for Body<T> {
    type Rejection = Response;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        match axum::Json::<T>::from_request(req, state).await {
            Ok(axum::Json(v)) => Ok(Body(v)),
            Err(e) => {
                let kind = match &e {
                    JsonRejection::JsonDataError(_) => "value_error",
                    JsonRejection::JsonSyntaxError(_) => "json_invalid",
                    _ => "model_attributes_type",
                };
                let detail = json!([{"loc": ["body"], "msg": e.body_text(), "type": kind}]);
                Err((StatusCode::UNPROCESSABLE_ENTITY, axum::Json(json!({"detail": detail}))).into_response())
            }
        }
    }
}
