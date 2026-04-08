from fastapi import FastAPI
import os

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Checkmate Test Server is Running"}

@app.get("/health")
def health_check():
    # This is the endpoint you'll point Checkmate to
    return {"status": "up"}

if __name__ == "__main__":
    import uvicorn
    # Render provides a $PORT environment variable
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
