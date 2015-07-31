// Filename: public/havewemet.js

angular.module('HaveWeMetApp', ['ngRoute'])
.config(['$routeProvider', function($routeProvider) {
  $routeProvider.
    when('/', {
      templateUrl: 'main.html',
    }).
    when('/card/:cardId', {
      templateUrl: 'card.html',
      controller: 'CardViewCtrl'
    }).
    when('/stats/:number/:timestamp/:token', {
      templateUrl: 'stats.html',
      controller: 'StatsViewCtrl'
    }).
    when('/setup/:number/:timestamp/:token', {
      templateUrl: 'setup.html',
      controller: 'CardSetupCtrl'
    }).
    otherwise({
      redirectTo: '/'
    });
}])
.controller('CardViewCtrl', ['$scope', '$http', '$routeParams', function($scope, $http, $routeParams) {

  $http.get('/api/card/'+$routeParams.cardId).success(function(profile) {
    console.log(profile);
    $scope.profile = profile;
  });
}])
.controller('CardSetupCtrl', ['$scope', '$http', '$routeParams', '$location', function($scope, $http, $routeParams, $location) {

  $http.get('/api/profile/'+$routeParams.number+'/'+$routeParams.timestamp+'/'+$routeParams.token).success(function(response) {
    if(response.error)
    {
      alert(response.error);
      return;
    }

    $scope.profile = response;
  });

  $scope.addResource = function()
  {
    $scope.profile.resources.push({type: $scope.resourcetype, value: $scope.resourcevalue});
  }

  $scope.removeResource = function(index)
  {
    alert(index);
    $scope.profile.resources.splice(index, 1);
  }

  $scope.saveProfile = function()
  {
    $http.post('/api/profile/'+$routeParams.number+'/'+$routeParams.timestamp+'/'+$routeParams.token, {profile: $scope.profile}).success(function(response) {
      $location.path('/stats/'+$routeParams.number+'/'+$routeParams.timestamp+'/'+$routeParams.token);
    });
  }
}])
.controller('StatsViewCtrl', ['$scope', '$http', '$routeParams', function($scope, $http, $routeParams) {
  $scope.changeSort = function(field)
  {
    $scope.sortField = field;
  }
  $scope.sortField = 'name';

  $http.get('/api/cards/'+$routeParams.number+'/'+$routeParams.timestamp+'/'+$routeParams.token, {profile: $scope.profile}).success(function(response) {
    if(response.error) {
      alert(response.error);
      return;
    }

    $scope.cards = response;
  });
}])