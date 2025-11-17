const express = require('express');
const multer = require('multer');
const supabase = require('../db/supabaseClient');
const { adminRequired } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 10 } });

// Helper: converte variation (com keys) para variation com URLs em images
async function variationWithAccessibleImages(variation) {
  const clone = { ...variation };
  if (Array.isArray(clone.images) && clone.images.length) {
    const urls = await Promise.all(clone.images.map(async imgKey => {
      try {
        // Primeiro tenta public URL (sempre funciona, mesmo com anon key)
        const pub = supabase.storage.from('product_images').getPublicUrl(imgKey);
        if (pub?.data?.publicUrl) {
          return pub.data.publicUrl;
        } else if (pub?.publicURL) {
          // Fallback para formato antigo
          return pub.publicURL;
        }
        return null;
      } catch (e) {
        console.error('Erro ao gerar URL para imagem de variação:', imgKey, e);
        return null;
      }
    }));
    clone.images = urls.filter(Boolean);
  } else {
    clone.images = [];
  }
  return clone;
}

// Admin: create product variation with image upload support
router.post('/', adminRequired, upload.fields([
  { name: 'pc_images', maxCount: 5 },
  { name: 'mobile_images', maxCount: 5 }
]), async (req, res) => {
  try {
    console.log('Received variation data:', req.body);
    const { product_id, name, color, size, price, stock } = req.body;
    
    // Validar campos obrigatórios
    if (!product_id || !name) {
      return res.status(400).json({ 
        error: 'Campos obrigatórios: product_id e name' 
      });
    }
    
    // Handle image uploads
    const pcFiles = req.files?.pc_images || [];
    const mobileFiles = req.files?.mobile_images || [];
    const pcImageKeys = [];
    const mobileImageKeys = [];

    // Upload PC images
    for (let i = 0; i < pcFiles.length; i++) {
      const f = pcFiles[i];
      const ext = (f.originalname && f.originalname.split('.').pop()) || 'jpg';
      const key = `variations/${product_id}/pc/${Date.now()}_${i}.${ext}`;

      const result = await supabase.storage.from('product_images').upload(key, f.buffer, { 
        contentType: f.mimetype,
        upsert: true
      });

      if (result.error) {
        console.error('Erro upload imagem PC de variação', result.error);
        if (result.error.statusCode === '403' || 
            result.error.statusCode === '500' || 
            result.error.message?.includes('row-level security') || 
            result.error.message?.includes('policy') ||
            result.error.message?.includes('Internal Server Error')) {
          console.warn('Storage error - Variation will be created without PC images.');
          console.warn('Check that the product_images bucket exists in Supabase Storage');
          break;
        }
        return res.status(500).json({ error: 'Erro ao fazer upload das imagens PC', detail: result.error.message || result.error });
      }

      pcImageKeys.push(key);
    }

    // Upload mobile images
    for (let i = 0; i < mobileFiles.length; i++) {
      const f = mobileFiles[i];
      const ext = (f.originalname && f.originalname.split('.').pop()) || 'jpg';
      const key = `variations/${product_id}/mobile/${Date.now()}_${i}.${ext}`;

      const result = await supabase.storage.from('product_images').upload(key, f.buffer, { 
        contentType: f.mimetype,
        upsert: true
      });

      if (result.error) {
        console.error('Erro upload imagem mobile de variação', result.error);
        if (result.error.statusCode === '403' || 
            result.error.statusCode === '500' || 
            result.error.message?.includes('row-level security') || 
            result.error.message?.includes('policy') ||
            result.error.message?.includes('Internal Server Error')) {
          console.warn('Storage error - Variation will be created without mobile images.');
          console.warn('Check that the product_images bucket exists in Supabase Storage');
          break;
        }
        return res.status(500).json({ error: 'Erro ao fazer upload das imagens mobile', detail: result.error.message || result.error });
      }

      mobileImageKeys.push(key);
    }
    
    // Combine all images for the general images field (PC images first)
    const allImageKeys = [...pcImageKeys, ...mobileImageKeys];
    
    const variationInsert = { 
      product_id,
      name,
      color: color || null,
      size: size || null,
      price: Number(price || 0),
      stock: Number(stock || 0),
      pc_images: pcImageKeys,
      mobile_images: mobileImageKeys,
      images: allImageKeys // Use all uploaded image keys
    };
    
    console.log('Inserting variation:', variationInsert);
    
    const { data: variation, error } = await supabase
      .from('product_variations')
      .insert([variationInsert])
      .select()
      .single();
      
    if (error) {
      console.error('Erro ao criar variação:', error);
      return res.status(400).json({ error: error.message });
    }
    
    console.log('Created variation:', variation);
    
    const variationWithUrls = await variationWithAccessibleImages(variation);
    res.json({ variation: variationWithUrls });
  } catch (err) {
    console.error('POST /api/variations error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: get variations for a product
router.get('/product/:product_id', async (req, res) => {
  try {
    const product_id = req.params.product_id;
    
    if (!product_id) {
      return res.status(400).json({ error: 'ID do produto inválido' });
    }
    
    const { data: variations, error } = await supabase
      .from('product_variations')
      .select('*')
      .eq('product_id', product_id)
      .eq('is_active', true)
      .order('color', { ascending: true })
      .order('size', { ascending: true });
      
    if (error) {
      console.error('Erro ao buscar variações:', error);
      return res.status(500).json({ error: error.message });
    }
    
    const variationsWithUrls = await Promise.all(
      (variations || []).map(variation => variationWithAccessibleImages(variation))
    );
    
    res.json({ variations: variationsWithUrls });
  } catch (err) {
    console.error('GET /api/variations/product/:product_id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: update product variation with image upload support
router.put('/:id', adminRequired, upload.fields([
  { name: 'pc_images', maxCount: 5 },
  { name: 'mobile_images', maxCount: 5 }
]), async (req, res) => {
  try {
    console.log('Updating variation with ID:', req.params.id);
    console.log('Received update data:', req.body);
    const id = req.params.id;
    const { name, color, size, price, stock, is_active } = req.body;
    
    // Construir objeto de mudanças apenas com campos válidos
    const changes = {};
    
    if (name !== undefined) changes.name = name;
    if (color !== undefined) changes.color = color || null;
    if (size !== undefined) changes.size = size || null;
    if (price !== undefined) changes.price = Number(price || 0);
    if (stock !== undefined) changes.stock = Number(stock || 0);
    if (is_active !== undefined) changes.is_active = Boolean(is_active);
    
    // Handle image uploads if any
    const pcFiles = req.files?.pc_images || [];
    const mobileFiles = req.files?.mobile_images || [];
    
    if (pcFiles.length > 0 || mobileFiles.length > 0) {
      console.log('PUT /api/variations/:id - received PC images length:', pcFiles.length);
      console.log('PUT /api/variations/:id - received mobile images length:', mobileFiles.length);
      
      const pcImageKeys = [];
      const mobileImageKeys = [];

      // Upload PC images
      for (let i = 0; i < pcFiles.length; i++) {
        const f = pcFiles[i];
        const ext = (f.originalname && f.originalname.split('.').pop()) || 'jpg';
        const key = `variations/${req.params.id}/pc/${Date.now()}_${i}.${ext}`;

        const result = await supabase.storage.from('product_images').upload(key, f.buffer, { 
          contentType: f.mimetype,
          upsert: true
        });

        if (result.error) {
          console.error('Erro upload imagem PC de variação', result.error);
          if (result.error.statusCode === '403' || 
              result.error.statusCode === '500' || 
              result.error.message?.includes('row-level security') || 
              result.error.message?.includes('policy') ||
              result.error.message?.includes('Internal Server Error')) {
            console.warn('Storage error - Variation will be updated without new PC images.');
            console.warn('Check that the product_images bucket exists in Supabase Storage');
            break;
          }
          return res.status(500).json({ error: 'Erro ao fazer upload das imagens PC', detail: result.error.message || result.error });
        }

        pcImageKeys.push(key);
      }

      // Upload mobile images
      for (let i = 0; i < mobileFiles.length; i++) {
        const f = mobileFiles[i];
        const ext = (f.originalname && f.originalname.split('.').pop()) || 'jpg';
        const key = `variations/${req.params.id}/mobile/${Date.now()}_${i}.${ext}`;

        const result = await supabase.storage.from('product_images').upload(key, f.buffer, { 
          contentType: f.mimetype,
          upsert: true
        });

        if (result.error) {
          console.error('Erro upload imagem mobile de variação', result.error);
          if (result.error.statusCode === '403' || 
              result.error.statusCode === '500' || 
              result.error.message?.includes('row-level security') || 
              result.error.message?.includes('policy') ||
              result.error.message?.includes('Internal Server Error')) {
            console.warn('Storage error - Variation will be updated without new mobile images.');
            console.warn('Check that the product_images bucket exists in Supabase Storage');
            break;
          }
          return res.status(500).json({ error: 'Erro ao fazer upload das imagens mobile', detail: result.error.message || result.error });
        }

        mobileImageKeys.push(key);
      }

      // If images were uploaded, add them to changes
      if (pcImageKeys.length > 0 || mobileImageKeys.length > 0) {
        // Get existing images for this variation
        const { data: existingVariation } = await supabase
          .from('product_variations')
          .select('pc_images, mobile_images')
          .eq('id', id)
          .single();
          
        const existingPcImages = existingVariation?.pc_images || [];
        const existingMobileImages = existingVariation?.mobile_images || [];
        
        // Merge existing images with new ones
        if (pcImageKeys.length > 0) {
          changes.pc_images = [...existingPcImages, ...pcImageKeys];
        }
        if (mobileImageKeys.length > 0) {
          changes.mobile_images = [...existingMobileImages, ...mobileImageKeys];
        }
        
        // Update the general images field (PC images first)
        const allImages = [...existingPcImages, ...pcImageKeys, ...existingMobileImages, ...mobileImageKeys];
        changes.images = allImages;
      }
    }
    
    console.log('Updating variation with changes:', changes);
    
    const { data: variation, error } = await supabase
      .from('product_variations')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
      
    if (error) {
      console.error('Erro ao atualizar variação:', error);
      return res.status(400).json({ error: error.message });
    }
    
    console.log('Updated variation:', variation);
    
    const variationWithUrls = await variationWithAccessibleImages(variation);
    res.json({ variation: variationWithUrls });
  } catch (err) {
    console.error('PUT /api/variations/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: delete product variation
router.delete('/:id', adminRequired, async (req, res) => {
  try {
    const id = req.params.id;
    
    const { error } = await supabase
      .from('product_variations')
      .delete()
      .eq('id', id);
      
    if (error) {
      console.error('Erro ao excluir variação:', error);
      return res.status(400).json({ error: error.message });
    }
    
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/variations/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;