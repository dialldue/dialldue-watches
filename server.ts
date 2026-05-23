import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { 
  initializeDatabase, 
  getProducts, 
  createProduct, 
  updateProduct, 
  deleteProduct, 
  findUserByEmail, 
  createUser, 
  getWishlist, 
  toggleWishlist, 
  createReview,
  getDbStatus
} from './server/db.ts';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload size limits to allow base64 watch media uploads up to 20MB safely
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ limit: '20mb', extended: true }));

  // Initialize the MySQL database schema/pool or JSON fallbacks on startup
  await initializeDatabase();

  // API ROUTING

  // Get database status
  app.get('/api/db-status', (req, res) => {
    res.json(getDbStatus());
  });

  // Get all products (with their deep nested media & reviews)
  app.get('/api/products', async (req, res) => {
    try {
      const products = await getProducts();
      res.json(products);
    } catch (error: any) {
      console.error('Error in GET /api/products:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Create new product (Admin Only - client handles check, we store)
  app.post('/api/products', async (req, res) => {
    try {
      const { name, brand, price, originalPrice, stock, description, category, rating, image, features, media } = req.body;
      if (!name || !brand || !price) {
        return res.status(400).json({ error: 'Name, brand, and price are required parameters.' });
      }
      const newProduct = await createProduct({
        name,
        brand,
        price: Number(price),
        originalPrice: Number(originalPrice || price * 1.35),
        stock: Number(stock !== undefined ? stock : 10),
        description: description || '',
        category: category || 'Classic',
        rating: Number(rating || 4.5),
        image: image || '',
        features: Array.isArray(features) ? features : (features ? features.split(',').map((f: string) => f.trim()) : []),
        media: Array.isArray(media) ? media : [{ type: 'image', data: image || '' }]
      });
      res.status(201).json(newProduct);
    } catch (error: any) {
      console.error('Error in POST /api/products:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update product (Admin Only)
  app.put('/api/products/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, brand, price, originalPrice, stock, description, category, rating, reviews, features, media } = req.body;
      
      await updateProduct(id, {
        name,
        brand,
        price: Number(price),
        originalPrice: Number(originalPrice || price * 1.35),
        stock: Number(stock),
        description: description || '',
        category: category || 'Classic',
        rating: Number(rating),
        reviews: Number(reviews || 0),
        features: Array.isArray(features) ? features : (features ? features.split(',').map((f: string) => f.trim()) : []),
        media: Array.isArray(media) ? media : []
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error in PUT /api/products:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete product (Admin Only)
  app.delete('/api/products/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await deleteProduct(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error in DELETE /api/products:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Register user
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { name, email, password, isAdmin } = req.body;
      if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required fields.' });
      }
      const existingUser = await findUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: 'User with this email already exists.' });
      }

      const newUser = await createUser(email, name, password, Boolean(isAdmin));
      res.status(201).json({
        email: newUser.email,
        name: newUser.name,
        isAdmin: newUser.isAdmin
      });
    } catch (error: any) {
      console.error('Error in POST /api/auth/register:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Login user
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required fields.' });
      }

      // Special Check for Admin matching the prompt constants
      if (email === 'dialldue@gmail.com' && password === 'dialldue123###123') {
        const adminUser = await findUserByEmail(email);
        if (!adminUser) {
          // ensure admin exists in DB
          await createUser(email, 'Admin', password, true);
        }
        return res.json({ email, name: 'Admin', isAdmin: true });
      }

      const user = await findUserByEmail(email);
      if (!user || user.password !== password) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      res.json({
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin
      });
    } catch (error: any) {
      console.error('Error in POST /api/auth/login:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get wishlist for specified user email
  app.get('/api/wishlist/:email', async (req, res) => {
    try {
      const email = req.params.email;
      const wishlist = await getWishlist(email);
      res.json(wishlist);
    } catch (error: any) {
      console.error('Error in GET /api/wishlist:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Toggle user's wishlist item
  app.post('/api/wishlist/toggle', async (req, res) => {
    try {
      const { email, productId } = req.body;
      if (!email || !productId) {
        return res.status(400).json({ error: 'Email and productId are required fields.' });
      }
      const result = await toggleWishlist(email, parseInt(productId));
      res.json(result);
    } catch (error: any) {
      console.error('Error in POST /api/wishlist/toggle:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Create review for a product
  app.post('/api/products/:id/reviews', async (req, res) => {
    try {
      const productId = parseInt(req.params.id);
      const { user, rating, text, date } = req.body;
      
      if (!user || rating === undefined || !text) {
        return res.status(400).json({ error: 'User name, rating, and text are required fields.' });
      }

      await createReview(productId, {
        user,
        rating: Number(rating),
        text,
        date: date || new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })
      });
      res.status(201).json({ success: true });
    } catch (error: any) {
      console.error('Error in POST /api/reviews:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // PORT bindings must be 3000 according to Runtime Environment instructions
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
