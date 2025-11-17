document.addEventListener('DOMContentLoaded', async () => {
  // Verificar se há termo de busca na URL
  const urlParams = new URLSearchParams(window.location.search);
  const searchQuery = urlParams.get('search');
  
  if (searchQuery) {
    // Se houver termo de busca, realizar a busca
    document.getElementById('search-input').value = searchQuery;
    // Redirecionar para a página de pesquisa
    window.location.href = `/pages/pesquisa.html?q=${encodeURIComponent(searchQuery)}`;
  } else {
    await loadProductsFromAPI();
  }
  
  // Aplicar fundo do site com base no dispositivo
  if (typeof applySiteBackground === 'function') {
    applySiteBackground();
  }
});

// Função para carregar produtos da API
async function loadProductsFromAPI() {
  try {
    const productsGrid = document.getElementById('product-list');
    if (!productsGrid) return;
    
    productsGrid.innerHTML = '<div class="loading">Carregando produtos...</div>';
    
    // Fazer a requisição para a API
    const response = await fetch('/api/products?limit=12&sort=newest');
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.message || 'Erro ao carregar produtos');
    }
    
    // Renderizar produtos
    renderProducts(data.products);
  } catch (error) {
    console.error('Erro ao carregar produtos:', error);
    const productsGrid = document.getElementById('product-list');
    if (productsGrid) {
      productsGrid.innerHTML = `
        <div class="error-message">
          Ocorreu um erro ao carregar os produtos. Por favor, tente novamente.
        </div>
      `;
    }
  }
}

// Função para renderizar produtos
function renderProducts(products) {
  const productsGrid = document.getElementById('product-list');
  if (!productsGrid) return;
  
  if (!products || products.length === 0) {
    productsGrid.innerHTML = `
      <div class="no-products">
        Nenhum produto encontrado.
      </div>
    `;
    return;
  }
  
  productsGrid.innerHTML = products.map(product => `
    <div class="product-card" data-product-id="${product.id}">
      <div class="product-image">
        <img src="${product.image || product.images?.[0] || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="400"%3E%3Crect fill="%23f8f9fa" width="300" height="400"/%3E%3C/svg%3E'}" alt="${product.name}">
      </div>
      <div class="product-info">
        <h3>${product.name}</h3>
        <div class="product-price">
          ${product.discount ? `
            <span class="original-price">R$ ${product.originalPrice.toFixed(2)}</span>
          ` : ''}
          <span class="current-price">R$ ${product.price.toFixed(2)}</span>
        </div>
      </div>
    </div>
  `).join('');
  
  // Adicionar event listeners para os cards de produto
  document.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', (e) => {
      const productId = card.dataset.productId;
      window.location.href = `/pages/product.html?id=${productId}`;
    });
  });
}