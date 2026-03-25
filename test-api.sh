#!/bin/bash

echo "Testing TraceLab Test Server APIs"
echo "=================================="
echo ""

# Test 1: Create a user
echo "1. Creating a user..."
curl -X POST http://localhost:3000/api/test-users \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice Smith","email":"alice@example.com","age":28}'
echo -e "\n"

# Test 2: Get all users
echo "2. Getting all users..."
curl http://localhost:3000/api/test-users
echo -e "\n"

# Test 3: Create another user
echo "3. Creating another user..."
curl -X POST http://localhost:3000/api/test-users \
  -H "Content-Type: application/json" \
  -d '{"name":"Bob Johnson","email":"bob@example.com","age":35}'
echo -e "\n"

# Test 4: Invalid user (should fail validation)
echo "4. Testing validation (invalid email)..."
curl -X POST http://localhost:3000/api/test-users \
  -H "Content-Type: application/json" \
  -d '{"name":"Invalid User","email":"not-an-email","age":25}'
echo -e "\n"

echo "=================================="
echo "Tests complete! Check the visualizer at http://localhost:3000"
